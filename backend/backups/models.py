import datetime

from django.db import models


class BackupSettings(models.Model):
    """تنظیمات پشتیبان‌گیری خودکار (فقط یک ردیف)."""

    enabled = models.BooleanField("فعال", default=True)
    run_time = models.TimeField("ساعت اجرای روزانه", default=datetime.time(3, 0))
    keep_days = models.PositiveSmallIntegerField("نگهداری (روز)", default=14)
    include_files = models.BooleanField("شامل فایل‌های نصب نسخه‌ها", default=False)
    last_auto_date = models.DateField("آخرین روز اجرای خودکار", null=True, blank=True)

    @classmethod
    def get(cls) -> "BackupSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Backup(models.Model):
    class Kind(models.TextChoices):
        AUTO = "auto", "خودکار"
        MANUAL = "manual", "دستی"
        SAFETY = "safety", "ایمنی"
        UPLOADED = "uploaded", "بارگذاری‌شده"

    kind = models.CharField(max_length=12, choices=Kind.choices)
    created_at = models.DateTimeField(db_index=True)
    filename = models.CharField(max_length=200, blank=True)
    size = models.BigIntegerField(default=0)
    include_files = models.BooleanField(default=False)
    ok = models.BooleanField(default=True)
    error = models.CharField(max_length=300, blank=True)
    created_by = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["-created_at", "-pk"]


class Operation(models.Model):
    class Kind(models.TextChoices):
        BACKUP = "backup", "پشتیبان‌گیری"
        RESTORE = "restore", "بازگردانی"

    class Status(models.TextChoices):
        QUEUED = "queued", "در صف"
        RUNNING = "running", "در حال اجرا"
        OK = "ok", "موفق"
        FAILED = "failed", "ناموفق"
        CANCELLED = "cancelled", "لغو شد"

    kind = models.CharField(max_length=10, choices=Kind.choices)
    trigger = models.CharField(max_length=10, default="manual")  # auto | manual
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.QUEUED)
    backup = models.ForeignKey(Backup, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    params = models.JSONField(default=dict, blank=True)
    pct = models.PositiveSmallIntegerField(default=0)
    stage = models.CharField(max_length=200, blank=True)
    logs = models.JSONField(default=list, blank=True)
    message = models.CharField(max_length=400, blank=True)
    cancel_requested = models.BooleanField(default=False)
    cancellable = models.BooleanField(default=True)
    dismissed = models.BooleanField(default=False)
    created_by = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-pk"]

    @property
    def active(self) -> bool:
        return self.status in (self.Status.QUEUED, self.Status.RUNNING)
