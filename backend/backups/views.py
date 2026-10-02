"""API پشتیبان‌گیری: /api/settings/backups/ (بخش «backup»)."""

import datetime
import os
import time

from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.conf import settings
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from . import service
from .models import Backup, BackupSettings, Operation

HEARTBEAT = ".scheduler"


def scheduler_alive() -> bool:
    try:
        return time.time() - (service.root() / HEARTBEAT).stat().st_mtime < 60
    except OSError:
        return False


def next_run(cfg: BackupSettings):
    """زمان اجرای بعدی؛ اگر امروز هنوز اجرا نشده و ساعتش گذشته، زمان‌بند همین حالا اجرا می‌کند."""
    if not cfg.enabled:
        return None
    now = timezone.localtime()
    today = now.replace(hour=cfg.run_time.hour, minute=cfg.run_time.minute, second=0, microsecond=0)
    if cfg.last_auto_date == now.date():
        return today + datetime.timedelta(days=1)
    return today if now < today else now


def backup_row(b: Backup, cfg: BackupSettings) -> dict:
    age = (timezone.now() - b.created_at).total_seconds()
    expiring = b.kind == Backup.Kind.AUTO and age >= (cfg.keep_days - 1) * 86400
    return {
        "id": b.pk, "kind": b.kind, "created_at": b.created_at.isoformat(), "size": b.size,
        "include_files": b.include_files, "ok": b.ok, "error": b.error, "by": b.created_by,
        "expiring": expiring,
    }


def op_row(op: Operation) -> dict:
    prog = service.read_progress(op) if op.active else None
    now = timezone.now()
    end = op.ended_at or now
    return {
        "id": op.pk, "kind": op.kind, "trigger": op.trigger, "status": op.status,
        "pct": prog["pct"] if prog else op.pct,
        "stage": (prog["stage"] if prog else op.stage) or ("در صف اجرا" if op.status == "queued" else ""),
        "logs": prog["logs"] if prog else op.logs,
        "cancellable": (prog["cancellable"] if prog else op.cancellable) and op.active,
        "message": op.message, "backup_id": op.backup_id, "by": op.created_by,
        "started_at": op.started_at.isoformat() if op.started_at else None,
        "elapsed": int((end - (op.started_at or op.created_at)).total_seconds()),
    }


def current_op() -> Operation | None:
    op = Operation.objects.filter(dismissed=False).first()
    if op and not op.active and op.ended_at and (timezone.now() - op.ended_at) > datetime.timedelta(hours=1):
        return None
    return op


def settings_row(cfg: BackupSettings) -> dict:
    return {
        "enabled": cfg.enabled, "run_time": cfg.run_time.strftime("%H:%M"),
        "keep_days": cfg.keep_days, "include_files": cfg.include_files,
    }


class OverviewView(APIView):
    def get(self, request):
        cfg = BackupSettings.get()
        op = current_op()
        nxt = next_run(cfg)
        return Response({
            "settings": settings_row(cfg),
            "backups": [backup_row(b, cfg) for b in Backup.objects.all()],
            "op": op_row(op) if op else None,
            "next_run": nxt.isoformat() if nxt else None,
            "files_size": service.release_files_size(),
            "scheduler_alive": scheduler_alive(),
            "confirm_word": service.CONFIRM_WORD,
        })


class SettingsView(APIView):
    def patch(self, request):
        cfg = BackupSettings.get()
        d = request.data
        if "enabled" in d:
            cfg.enabled = bool(d["enabled"])
        if "include_files" in d:
            cfg.include_files = bool(d["include_files"])
        if "run_time" in d:
            try:
                h, m = str(d["run_time"]).split(":")[:2]
                cfg.run_time = datetime.time(int(h), int(m))
            except (ValueError, TypeError):
                return Response({"run_time": ["ساعت نامعتبر است."]}, status=status.HTTP_400_BAD_REQUEST)
        if "keep_days" in d:
            try:
                k = int(d["keep_days"])
            except (ValueError, TypeError):
                k = 0
            if not 1 <= k <= 90:
                return Response({"keep_days": ["مدت نگهداری باید بین ۱ تا ۹۰ روز باشد."]}, status=status.HTTP_400_BAD_REQUEST)
            cfg.keep_days = k
        cfg.save()
        return Response(settings_row(cfg))


def busy():
    return Response({"detail": "عملیات دیگری در جریان است."}, status=status.HTTP_409_CONFLICT)


class RunView(APIView):
    def post(self, request):
        if Operation.objects.filter(status__in=[Operation.Status.QUEUED, Operation.Status.RUNNING]).exists():
            return busy()
        cfg = BackupSettings.get()
        include = request.data.get("include_files", cfg.include_files)
        op = Operation.objects.create(
            kind=Operation.Kind.BACKUP, trigger="manual", created_by=request.user.username,
            params={"include_files": bool(include)},
        )
        return Response(op_row(op), status=status.HTTP_201_CREATED)


class RestoreView(APIView):
    def post(self, request, pk):
        b = get_object_or_404(Backup, pk=pk)
        if not b.ok or not b.filename or not (service.root() / b.filename).is_file():
            return Response({"detail": "فایل این پشتیبان در دسترس نیست."}, status=status.HTTP_400_BAD_REQUEST)
        if (request.data.get("confirm") or "").strip() != service.CONFIRM_WORD:
            return Response({"confirm": ["برای تأیید، کلمهٔ «بازگردانی» را تایپ کنید."]}, status=status.HTTP_400_BAD_REQUEST)
        if Operation.objects.filter(status__in=[Operation.Status.QUEUED, Operation.Status.RUNNING]).exists():
            return busy()
        op = Operation.objects.create(
            kind=Operation.Kind.RESTORE, trigger="manual", created_by=request.user.username,
            params={"backup_id": b.pk, "safety": request.data.get("safety", True) is not False},
        )
        return Response(op_row(op), status=status.HTTP_201_CREATED)


class BackupDetailView(APIView):
    def delete(self, request, pk):
        b = get_object_or_404(Backup, pk=pk)
        active = Operation.objects.filter(status__in=[Operation.Status.QUEUED, Operation.Status.RUNNING]).first()
        if active and active.params.get("backup_id") == b.pk:
            return busy()
        service.delete_backup(b)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DownloadView(APIView):
    def get(self, request, pk):
        b = get_object_or_404(Backup, pk=pk)
        path = service.root() / b.filename if b.filename else None
        if not path or not path.is_file():
            raise Http404
        return FileResponse(path.open("rb"), as_attachment=True, filename=b.filename)


class OperationView(APIView):
    def get(self, request):
        op = current_op()
        return Response(op_row(op) if op else None)


class OperationCancelView(APIView):
    def post(self, request, pk):
        op = get_object_or_404(Operation, pk=pk)
        if not op.active:
            return Response({"detail": "عملیات تمام شده است."}, status=status.HTTP_409_CONFLICT)
        row = op_row(op)
        if not row["cancellable"]:
            return Response({"detail": "در این مرحله لغو ممکن نیست."}, status=status.HTTP_409_CONFLICT)
        op.cancel_requested = True
        op.save(update_fields=["cancel_requested"])
        if op.status == Operation.Status.QUEUED:
            op.status, op.message, op.ended_at = Operation.Status.CANCELLED, "عملیات لغو شد.", timezone.now()
            op.save(update_fields=["status", "message", "ended_at"])
        return Response(op_row(op))


class OperationDismissView(APIView):
    def post(self, request, pk):
        op = get_object_or_404(Operation, pk=pk)
        if op.active:
            return Response({"detail": "عملیات هنوز در جریان است."}, status=status.HTTP_409_CONFLICT)
        op.dismissed = True
        op.save(update_fields=["dismissed"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class UploadView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request):
        f = request.FILES.get("file")
        if not f or not f.name.lower().endswith(".adbk"):
            return Response({"detail": "فقط فایل با پسوند .adbk پذیرفته می‌شود."}, status=status.HTTP_400_BAD_REQUEST)
        if f.size > settings.BACKUP_MAX_UPLOAD:
            return Response({"detail": "حجم فایل بیشتر از ۴ گیگابایت است."}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        name = service.backup_filename("uploaded")
        dest = service.root() / name
        with dest.open("wb") as out:
            for chunk in f.chunks():
                out.write(chunk)
        try:
            manifest = service.inspect_archive(dest)
        except ValueError as e:
            dest.unlink(missing_ok=True)
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            created = datetime.datetime.fromisoformat(manifest["created_at"])
        except (KeyError, ValueError):
            created = timezone.now()
        b = Backup.objects.create(
            kind=Backup.Kind.UPLOADED, created_at=created, filename=name, size=dest.stat().st_size,
            include_files=bool(manifest.get("include_files")), created_by=request.user.username,
        )
        return Response(backup_row(b, BackupSettings.get()), status=status.HTTP_201_CREATED)
