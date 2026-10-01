"""قوانین هشدار. با هر نمونه دریافتی از agent و هنگام خواندن وضعیت (برای سرورهای قطع) اجرا می‌شود."""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Avg, Min
from django.utils import timezone

from .models import Alert, AlertLevel, MetricSample, Server

CPU_HIGH = 80
CPU_WINDOW = timedelta(minutes=10)
CPU_CLEAR = 70
RAM_HIGH = 90
RAM_CLEAR = 85
DISK_WARN = 85
DISK_CRIT = 95
DISK_CLEAR = 80


def fa_num(v) -> str:
    return str(v).translate(str.maketrans("0123456789.", "۰۱۲۳۴۵۶۷۸۹٫"))


def open_alert(server: Server | None, kind: str, level: str, title: str, detail: str = "") -> Alert | None:
    """یک هشدار باز می‌کند مگر اینکه هشدار باز همین نوع وجود داشته باشد. سطح و متن را به‌روز می‌کند."""
    current = Alert.objects.filter(server=server, kind=kind, resolved_at__isnull=True).first()
    if current:
        if current.level != level or current.title != title or current.detail != detail:
            current.level, current.title, current.detail = level, title, detail
            current.save(update_fields=["level", "title", "detail"])
        return current
    try:
        with transaction.atomic():
            return Alert.objects.create(server=server, kind=kind, level=level, title=title, detail=detail)
    except IntegrityError:  # درخواست همزمان قبلاً ساخته است
        return None


def resolve_alert(server: Server | None, kind: str) -> None:
    Alert.objects.filter(server=server, kind=kind, resolved_at__isnull=True).update(resolved_at=timezone.now())


def record_event(server: Server | None, kind: str, level: str, title: str, detail: str = "") -> Alert:
    """رویداد یک‌باره (مثلاً اتصال سرور جدید) که از همان ابتدا بسته است ولی تا بررسی در فهرست می‌ماند."""
    now = timezone.now()
    return Alert.objects.create(
        server=server, kind=kind, level=level, title=title, detail=detail, opened_at=now, resolved_at=now
    )


def evaluate_sample(server: Server, sample: MetricSample) -> None:
    now = sample.ts

    # CPU: میانگین ۱۰ دقیقه اخیر، به شرطی که داده کافی (پوشش کل پنجره) داشته باشیم
    window = MetricSample.objects.filter(server=server, ts__gte=now - CPU_WINDOW, ts__lte=now).aggregate(
        avg=Avg("cpu"), first=Min("ts")
    )
    covered = window["first"] is not None and (now - window["first"]) >= CPU_WINDOW * 0.9
    if covered and window["avg"] >= CPU_HIGH:
        open_alert(
            server,
            "cpu_high",
            AlertLevel.CRIT,
            f"مصرف CPU بالای {fa_num(CPU_HIGH)}٪",
            f"{server.name} · ۱۰ دقیقه متوالی · میانگین {fa_num(round(window['avg']))}٪",
        )
    elif window["avg"] is not None and window["avg"] < CPU_CLEAR:
        resolve_alert(server, "cpu_high")

    if sample.ram >= RAM_HIGH:
        open_alert(
            server,
            "ram_high",
            AlertLevel.WARN,
            f"مصرف حافظه بالای {fa_num(RAM_HIGH)}٪",
            f"{server.name} · {fa_num(round(sample.ram))}٪ در حال حاضر",
        )
    elif sample.ram < RAM_CLEAR:
        resolve_alert(server, "ram_high")

    if sample.disk >= DISK_WARN:
        level = AlertLevel.CRIT if sample.disk >= DISK_CRIT else AlertLevel.WARN
        open_alert(
            server,
            "disk_high",
            level,
            "فضای دیسک رو به اتمام",
            f"{server.name} · {fa_num(round(sample.disk))}٪ پر شده",
        )
    elif sample.disk < DISK_CLEAR:
        resolve_alert(server, "disk_high")

    resolve_alert(server, "offline")


def check_offline_servers() -> None:
    for server in Server.objects.filter(last_seen__isnull=False):
        if server.online:
            continue
        open_alert(
            server,
            "offline",
            AlertLevel.CRIT,
            "سرور گزارشی ارسال نمی‌کند",
            f"{server.name} · آخرین گزارش {fa_num(timezone.localtime(server.last_seen).strftime('%H:%M'))}",
        )
