"""ساخت و بازگردانی پشتیبان (.adbk = tar.gz شامل manifest.json، db.jsonl و در صورت نیاز releases/).

دیتابیس با سریالایزر Django به‌صورت JSON خطی ذخیره می‌شود؛ پس به نسخهٔ Postgres و
ابزار pg_dump وابسته نیست. پیشرفت عملیات در یک فایل کنار پشتیبان‌ها نوشته می‌شود
(نه دیتابیس)، چون بازگردانی داخل یک تراکنش بزرگ اجرا می‌شود و به‌روزرسانی‌های دیتابیس
تا پایان تراکنش دیده نمی‌شوند.
"""

import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import time
from datetime import timedelta
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.contrib.sessions.models import Session
from django.core import serializers
from django.core.management.color import no_style
from django.db import connection, transaction
from django.utils import timezone

from .models import Backup, BackupSettings, Operation

FORMAT = 1
CONFIRM_WORD = "بازگردانی"
EXCLUDED = {"contenttypes.contenttype", "auth.permission", "sessions.session", "admin.logentry"}
EXCLUDED_APPS = {"backups"}


class Cancelled(Exception):
    pass


def root() -> Path:
    p = Path(settings.BACKUPS_ROOT)
    p.mkdir(parents=True, exist_ok=True)
    return p


def dump_models():
    return sorted(
        (m for m in apps.get_models() if m._meta.label_lower not in EXCLUDED and m._meta.app_label not in EXCLUDED_APPS),
        key=lambda m: m._meta.label_lower,
    )


def files_root() -> Path:
    return Path(settings.RELEASES_ROOT)


def iter_release_files():
    base = files_root()
    if not base.is_dir():
        return
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d != ".uploads"]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.is_file() and not p.is_symlink():
                yield p


def release_files_size() -> int:
    return sum(p.stat().st_size for p in iter_release_files())


def fmt_size(n: int) -> str:
    return f"{n / 1024 ** 3:.2f} GB" if n >= 1024 ** 3 else f"{n / 1024 ** 2:.1f} MB"


class Tracker:
    """گزارش پیشرفت و لاگ زنده یک عملیات (فایل JSON روی volume مشترک)."""

    def __init__(self, op: Operation):
        self.op = op
        self.path = root() / f".op-{op.pk}.json"
        self.state = {"pct": 0, "stage": "", "logs": [], "cancellable": True}
        self._last = 0.0
        self.flush(force=True)

    def flush(self, force=False):
        now = time.monotonic()
        if not force and now - self._last < 0.4:
            return
        self._last = now
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False))
        os.replace(tmp, self.path)

    def log(self, txt: str, lvl: str = "info"):
        self.state["logs"].append({"t": timezone.localtime().strftime("%H:%M:%S"), "txt": txt, "lvl": lvl})
        self.flush(force=True)

    def set(self, pct: float, stage: str | None = None):
        self.state["pct"] = max(0, min(100, int(pct)))
        if stage is not None:
            self.state["stage"] = stage
        self.flush(force=stage is not None)

    def lock(self):
        self.state["cancellable"] = False
        self.flush(force=True)

    def check_cancel(self):
        if self.state["cancellable"] and Operation.objects.filter(pk=self.op.pk, cancel_requested=True).exists():
            raise Cancelled()

    def close(self):
        self.path.unlink(missing_ok=True)


def read_progress(op: Operation) -> dict | None:
    try:
        return json.loads((root() / f".op-{op.pk}.json").read_text())
    except (OSError, ValueError):
        return None


def backup_filename(kind: str) -> str:
    return f"asandesk-{timezone.localtime().strftime('%Y%m%d-%H%M%S')}-{kind}.adbk"


def enforce_retention(tr: Tracker | None = None) -> int:
    cfg = BackupSettings.get()
    cutoff = timezone.now() - timedelta(days=cfg.keep_days)
    removed = 0
    for b in Backup.objects.filter(kind=Backup.Kind.AUTO, created_at__lt=cutoff):
        delete_backup(b)
        removed += 1
    if removed and tr:
        tr.log(f"حذف {removed} پشتیبان قدیمی‌تر از {cfg.keep_days} روز")
    return removed


def delete_backup(b: Backup):
    if b.filename:
        (root() / b.filename).unlink(missing_ok=True)
    b.delete()


# ---------------------------------------------------------------- ساخت پشتیبان

def create_backup(op: Operation, tr: Tracker, kind: str, include_files: bool, base: int = 0, span: int = 100) -> Backup:
    """ساخت یک فایل پشتیبان؛ درصد پیشرفت در بازهٔ [base, base+span] گزارش می‌شود."""

    def pct(x):  # x از ۰ تا ۱۰۰ داخلی
        tr.set(base + span * x / 100)

    models = dump_models()
    name = backup_filename(kind)
    final = root() / name
    part = final.with_suffix(".part")
    tr.set(base, "آماده‌سازی")
    tr.log("شروع پشتیبان‌گیری " + ("خودکار" if kind == "auto" else "دستی" if kind == "manual" else "ایمنی"))
    counts: dict[str, int] = {}
    tmpdir = tempfile.mkdtemp(prefix="adbk-", dir=root())
    try:
        tr.log("✓ اتصال به دیتابیس", "ok")
        dbfile = Path(tmpdir) / "db.jsonl"
        with dbfile.open("w", encoding="utf-8") as f:
            for i, m in enumerate(models):
                tr.check_cancel()
                tr.set(base + span * (5 + 50 * i / len(models)) / 100, "در حال خروجی گرفتن از دیتابیس")
                n = 0
                for obj in m._default_manager.order_by("pk").iterator(chunk_size=2000):
                    serializers.serialize("jsonl", [obj], stream=f)
                    n += 1
                counts[m._meta.label_lower] = n
                if n:
                    tr.log(f"✓ {m._meta.label_lower} ({n} ردیف)", "ok")
        pct(55)
        total_rows = sum(counts.values())
        tr.log(f"✓ خروجی جدول‌ها ({total_rows} ردیف)", "ok")

        files = list(iter_release_files()) if include_files else []
        files_bytes = sum(p.stat().st_size for p in files)
        with tarfile.open(part, "w:gz", compresslevel=3) as tar:
            tar.add(dbfile, arcname="db.jsonl")
            done = 0
            for i, p in enumerate(files):
                tr.check_cancel()
                tar.add(p, arcname="releases/" + p.relative_to(files_root()).as_posix())
                done += p.stat().st_size
                tr.set(base + span * (55 + 35 * done / max(files_bytes, 1)) / 100, "فشرده‌سازی فایل‌های نسخه‌ها")
                tr.log(f"… فایل {i + 1} از {len(files)}")
            manifest = {
                "format": FORMAT, "created_at": timezone.now().isoformat(), "kind": kind,
                "include_files": include_files, "counts": counts, "files": len(files), "app": "asandesk-dashboard",
            }
            data = json.dumps(manifest, ensure_ascii=False).encode()
            info = tarfile.TarInfo("manifest.json")
            info.size = len(data)
            info.mtime = time.time()
            import io
            tar.addfile(info, io.BytesIO(data))
        tr.set(base + span * 0.92, "نهایی‌سازی")
        os.replace(part, final)
        size = final.stat().st_size
        b = Backup.objects.create(
            kind=kind, created_at=timezone.now(), filename=name, size=size, include_files=include_files,
            created_by=op.created_by,
        )
        tr.log(f"✓ فایل پشتیبان ساخته شد ({fmt_size(size)})", "ok")
        return b
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def run_backup(op: Operation, tr: Tracker):
    kind = Backup.Kind.AUTO if op.trigger == "auto" else Backup.Kind.MANUAL
    b = create_backup(op, tr, kind, bool(op.params.get("include_files")))
    op.backup = b
    enforce_retention(tr)
    tr.set(100, "پایان")
    op.message = "پشتیبان با موفقیت ساخته شد"


# ---------------------------------------------------------------- بازگردانی

def inspect_archive(path: Path) -> dict:
    """بررسی فایل پشتیبان؛ در صورت نامعتبر بودن ValueError."""
    try:
        with tarfile.open(path, "r:gz") as tar:
            names = tar.getnames()
            if "manifest.json" not in names or "db.jsonl" not in names:
                raise ValueError("ساختار فایل پشتیبان نامعتبر است.")
            manifest = json.load(tar.extractfile("manifest.json"))
    except (tarfile.TarError, OSError, EOFError) as e:
        raise ValueError("فایل پشتیبان قابل خواندن نیست.") from e
    if manifest.get("format") != FORMAT:
        raise ValueError("نسخهٔ فرمت این پشتیبان پشتیبانی نمی‌شود.")
    return manifest


def run_restore(op: Operation, tr: Tracker):
    src = Backup.objects.get(pk=op.params["backup_id"])
    path = root() / src.filename
    tr.set(1, "بررسی فایل پشتیبان")
    tr.log(f"شروع بازگردانی از پشتیبان {timezone.localtime(src.created_at).strftime('%Y-%m-%d %H:%M')}")
    manifest = inspect_archive(path)
    tr.log("✓ فایل پشتیبان معتبر است", "ok")

    if op.params.get("safety"):
        tr.check_cancel()
        create_backup(op, tr, Backup.Kind.SAFETY, False, base=2, span=28)
        tr.log("✓ پشتیبان ایمنی از وضعیت فعلی ساخته شد", "ok")

    tmpdir = tempfile.mkdtemp(prefix="adbk-", dir=root())
    try:
        tr.check_cancel()
        tr.set(32, "استخراج فایل پشتیبان")
        with tarfile.open(path, "r:gz") as tar:
            dbfile = Path(tmpdir) / "db.jsonl"
            with tar.extractfile("db.jsonl") as r, dbfile.open("wb") as w:
                shutil.copyfileobj(r, w)
            release_members = [m for m in tar.getmembers() if m.isfile() and m.name.startswith("releases/")]
            restore_files = bool(manifest.get("include_files")) and release_members
            if restore_files:
                extracted = Path(tmpdir) / "files"
                for m in release_members:
                    target = (extracted / m.name[len("releases/"):]).resolve()
                    if not str(target).startswith(str(extracted.resolve())):
                        raise ValueError("مسیر نامعتبر در فایل پشتیبان")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with tar.extractfile(m) as r, target.open("wb") as w:
                        shutil.copyfileobj(r, w)
        tr.log("✓ استخراج شد", "ok")

        # از این‌جا به بعد لغو ممکن نیست
        tr.check_cancel()
        tr.lock()
        tr.set(45, "جایگزینی اطلاعات دیتابیس")
        models = dump_models()
        size = dbfile.stat().st_size or 1
        with transaction.atomic():
            for m in reversed(models):
                m._base_manager.all()._raw_delete(using="default")
            tr.log("✓ اطلاعات فعلی پاک شد", "ok")
            loaded = 0
            with dbfile.open("r", encoding="utf-8") as f:
                for obj in serializers.deserialize("jsonl", f, ignorenonexistent=True):
                    obj.save()
                    loaded += 1
                    if loaded % 200 == 0:
                        tr.set(45 + 40 * f.tell() / size)
            with connection.cursor() as cur:
                for sql in connection.ops.sequence_reset_sql(no_style(), models):
                    cur.execute(sql)
            Session.objects.all().delete()
        tr.log(f"✓ {loaded} ردیف بازگردانی شد", "ok")

        if restore_files:
            tr.set(88, "بازگردانی فایل‌های نسخه‌ها")
            base = files_root()
            base.mkdir(parents=True, exist_ok=True)
            for p in list(iter_release_files()):
                p.unlink(missing_ok=True)
            for p in (Path(tmpdir) / "files").rglob("*"):
                if p.is_file():
                    dest = base / p.relative_to(Path(tmpdir) / "files")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(p, dest)
            tr.log(f"✓ {len(release_members)} فایل نسخه بازگردانی شد", "ok")
        else:
            tr.log("این پشتیبان فایل‌های نصب را ندارد؛ فایل‌های فعلی دست‌نخورده ماند.", "warn")
        try:
            from releases.services import write_manifests
            write_manifests()
        except Exception as e:  # noqa: BLE001
            tr.log(f"به‌روزرسانی latest.json ناموفق بود: {e}", "warn")
        tr.set(100, "پایان")
        op.message = "بازگردانی با موفقیت انجام شد؛ همهٔ نشست‌ها بسته شد، دوباره وارد شوید."
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------- اجرای یک عملیات

def execute(op: Operation):
    op.status = Operation.Status.RUNNING
    op.started_at = timezone.now()
    op.save(update_fields=["status", "started_at"])
    tr = Tracker(op)
    try:
        if op.kind == Operation.Kind.BACKUP:
            run_backup(op, tr)
        else:
            run_restore(op, tr)
        op.status = Operation.Status.OK
        tr.log("✓ " + op.message, "ok")
    except Cancelled:
        op.status = Operation.Status.CANCELLED
        op.message = "عملیات لغو شد."
        tr.log(op.message, "warn")
    except Exception as e:  # noqa: BLE001
        op.status = Operation.Status.FAILED
        op.message = (str(e) or e.__class__.__name__)[:380]
        tr.log("✗ " + op.message, "err")
        if op.kind == Operation.Kind.BACKUP:
            kind = Backup.Kind.AUTO if op.trigger == "auto" else Backup.Kind.MANUAL
            op.backup = Backup.objects.create(
                kind=kind, created_at=timezone.now(), ok=False, error=op.message, created_by=op.created_by,
            )
    finally:
        op.pct = 100 if op.status == Operation.Status.OK else tr.state["pct"]
        op.stage = tr.state["stage"] if op.status != Operation.Status.OK else "پایان"
        op.logs = tr.state["logs"]
        op.cancellable = False
        op.ended_at = timezone.now()
        # نشست‌ها بعد از بازگردانی پاک شده‌اند؛ خود ردیف عملیات هم ممکن است حذف نشده باشد
        op.save()
        tr.close()
