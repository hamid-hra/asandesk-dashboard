"""زمان‌بند پس‌زمینه: اجرای صف پشتیبان/بازگردانی، پشتیبان‌گیری خودکار روزانه و بررسی سلامت سرورهای HA.

یک پروسهٔ جدا در docker compose (سرویس scheduler) است تا کارهای سنگین داخل worker های وب اجرا نشوند.
"""

import logging
import threading
import time
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

from backups import service
from backups.models import BackupSettings, Operation
from backups.views import HEARTBEAT

log = logging.getLogger("scheduler")


def beat():
    (service.root() / HEARTBEAT).write_text(str(time.time()))


def reap_stale():
    """عملیاتی که با خاموش‌شدن زمان‌بند نیمه‌کاره مانده، ناموفق ثبت می‌شود."""
    for op in Operation.objects.filter(status=Operation.Status.RUNNING):
        op.status, op.message, op.ended_at = Operation.Status.FAILED, "اجرا با خاموش‌شدن سرویس زمان‌بند قطع شد.", timezone.now()
        op.logs = (service.read_progress(op) or {}).get("logs", []) + [
            {"t": timezone.localtime().strftime("%H:%M:%S"), "txt": "✗ " + op.message, "lvl": "err"}]
        op.save()
        (service.root() / f".op-{op.pk}.json").unlink(missing_ok=True)


def maybe_schedule_auto():
    cfg = BackupSettings.get()
    now = timezone.localtime()
    if not cfg.enabled or cfg.last_auto_date == now.date() or now.time() < cfg.run_time:
        return
    if Operation.objects.filter(status__in=[Operation.Status.QUEUED, Operation.Status.RUNNING]).exists():
        return
    cfg.last_auto_date = now.date()
    cfg.save(update_fields=["last_auto_date"])
    Operation.objects.create(
        kind=Operation.Kind.BACKUP, trigger="auto", created_by="system",
        params={"include_files": cfg.include_files},
    )


def run_one():
    op = Operation.objects.filter(status=Operation.Status.QUEUED).order_by("created_at", "pk").first()
    if op:
        log.info("running %s #%s", op.kind, op.pk)
        service.execute(op)


def ha_loop(stop: threading.Event):
    from ha import checker
    from ha.models import HAConfig
    last_prune = 0.0
    while not stop.is_set():
        try:
            close_old_connections()
            checker.run_checks()
            if time.monotonic() - last_prune > 3600:
                checker.prune()
                last_prune = time.monotonic()
            interval = HAConfig.get().interval
        except Exception:  # noqa: BLE001
            log.exception("ha checks failed")
            interval = 10
        stop.wait(interval)


class Command(BaseCommand):
    help = "زمان‌بند پشتیبان‌گیری و بررسی سلامت HA"

    def handle(self, *args, **options):
        logging.basicConfig(level=logging.INFO)
        stop = threading.Event()
        threading.Thread(target=ha_loop, args=(stop,), daemon=True).start()
        reap_stale()
        log.info("scheduler started")
        while True:
            try:
                close_old_connections()
                beat()
                maybe_schedule_auto()
                run_one()
            except Exception:  # noqa: BLE001
                log.exception("scheduler tick failed")
            time.sleep(2)
