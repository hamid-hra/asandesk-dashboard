from django.conf import settings
from django.db import models
from django.utils import timezone


class Client(models.Model):
    """یک دستگاهی که آسان دسک روی آن نصب است و برای پشتیبانی گزارش می‌دهد.

    شناسهٔ یکتا = (rid, uuid). rid همان کد ۹ رقمی کاربر است و uuid شناسهٔ ثابت نصب.
    هیچ داده‌ای مخفیانه جمع نمی‌شود؛ کاربر موقع نصب مطلع می‌شود و می‌تواند خاموش کند.
    """

    rid = models.CharField("کد دستگاه", max_length=32, db_index=True)
    uuid = models.CharField(max_length=128, db_index=True)
    name = models.CharField("نام کاربر", max_length=128, blank=True)
    hostname = models.CharField("نام دستگاه", max_length=128, blank=True)
    os = models.CharField("سیستم‌عامل", max_length=128, blank=True)
    cpu = models.CharField(max_length=128, blank=True)
    memory = models.CharField(max_length=32, blank=True)
    version = models.CharField("نسخه", max_length=32, blank=True)
    ip = models.CharField("IP", max_length=64, blank=True)
    country = models.CharField("کشور", max_length=64, blank=True)
    city = models.CharField("شهر", max_length=64, blank=True)
    first_seen = models.DateTimeField("اولین بار", null=True, blank=True)
    last_seen = models.DateTimeField("آخرین بار", null=True, blank=True)
    blocked = models.BooleanField("مسدود", default=False)
    # فرمان یک‌بارهٔ «خروج اجباری» از پنل؛ بعد از اجرا پاک می‌شود
    force_disconnect = models.BooleanField(default=False)
    # آخرین شناسه‌های اتصال فعال که کلاینت گزارش داده (برای قطع از راه دور)
    last_conns = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_seen"]
        verbose_name = "کلاینت"
        verbose_name_plural = "کلاینت‌ها"
        constraints = [
            models.UniqueConstraint(fields=["rid", "uuid"], name="uniq_client_rid_uuid"),
        ]

    def __str__(self):
        return self.display_name

    @property
    def display_name(self) -> str:
        # اگر کاربر لاگین نکرده باشد، شناسهٔ سیستم (نام کاربر سیستم‌عامل@نام دستگاه)
        if self.name and self.hostname:
            return f"{self.name}@{self.hostname}"
        return self.name or self.hostname or self.rid

    @property
    def location(self) -> str:
        return " · ".join(x for x in (self.city, self.country) if x)

    @property
    def online(self) -> bool:
        if not self.last_seen:
            return False
        age = (timezone.now() - self.last_seen).total_seconds()
        return age <= settings.SERVER_OFFLINE_AFTER_SECONDS


class ClientSession(models.Model):
    """یک نشست کنترل از راه دور روی این دستگاه (طرف کنترل‌شونده)."""

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="sessions")
    conn_id = models.IntegerField(default=0)
    session_id = models.CharField(max_length=40, blank=True)
    peer_id = models.CharField("کد طرف مقابل", max_length=32, blank=True)
    peer_name = models.CharField("نام طرف مقابل", max_length=128, blank=True)
    conn_type = models.CharField(max_length=32, blank=True)
    ip = models.CharField(max_length=64, blank=True)
    started_at = models.DateTimeField(db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    # ترافیک در audit استاندارد نیست؛ برای آینده nullable می‌ماند
    bytes_in = models.BigIntegerField(null=True, blank=True)
    bytes_out = models.BigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        verbose_name = "نشست"
        verbose_name_plural = "نشست‌ها"
        indexes = [models.Index(fields=["client", "started_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["client", "conn_id", "session_id"], name="uniq_client_session"
            ),
        ]

    @property
    def duration_seconds(self):
        end = self.ended_at or timezone.now()
        return max(0, int((end - self.started_at).total_seconds()))
