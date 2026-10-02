from django.db import models
from django.utils import timezone


class HAConfig(models.Model):
    """تنظیمات سراسری HA (فقط یک ردیف)."""

    class Method(models.TextChoices):
        DNS = "dns", "تغییر رکورد DNS"
        VIP = "vip", "IP شناور (keepalived)"

    domain = models.CharField("دامنهٔ عمومی", max_length=200, default="rd.asandesk.ir")
    method = models.CharField(max_length=8, choices=Method.choices, default=Method.DNS)
    interval = models.PositiveSmallIntegerField("فاصلهٔ بررسی سلامت (ثانیه)", default=5)
    fails = models.PositiveSmallIntegerField("خطای پشت‌سرهم قبل از جابه‌جایی", default=3)
    failback = models.BooleanField("برگشت خودکار به سرور اصلی", default=True)

    @classmethod
    def get(cls) -> "HAConfig":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class HAServer(models.Model):
    class Role(models.TextChoices):
        PRIMARY = "primary", "اصلی"
        BACKUP = "backup", "پشتیبان"

    name = models.CharField(max_length=64, unique=True)
    address = models.CharField("IP یا دامنه", max_length=200)
    role = models.CharField(max_length=8, choices=Role.choices, default=Role.BACKUP)
    priority = models.PositiveSmallIntegerField(default=1)
    id_port = models.PositiveIntegerField(default=21116)
    relay_port = models.PositiveIntegerField(default=21117)
    maintenance = models.BooleanField("خارج از چرخه (تعمیرات)", default=False)
    draft = models.BooleanField(default=False)  # تا تأیید مرحلهٔ دوم دیالوگ افزودن
    monitor = models.OneToOneField("monitoring.Server", null=True, blank=True, on_delete=models.SET_NULL, related_name="ha")

    # آخرین وضعیت بررسی
    status = models.CharField(max_length=12, default="unknown")  # ok | slow | down | unknown
    latency_ms = models.IntegerField(null=True, blank=True)
    ports = models.JSONField(default=dict, blank=True)  # {"21116 TCP": true, ...}
    last_check = models.DateTimeField(null=True, blank=True)
    fail_count = models.PositiveSmallIntegerField(default=0)
    serving = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["priority", "pk"]


class HACheck(models.Model):
    server = models.ForeignKey(HAServer, on_delete=models.CASCADE, related_name="checks")
    ts = models.DateTimeField(default=timezone.now, db_index=True)
    ms = models.IntegerField(null=True, blank=True)
    ok = models.BooleanField(default=True)

    class Meta:
        indexes = [models.Index(fields=["server", "ts"])]


class HAEvent(models.Model):
    ts = models.DateTimeField(default=timezone.now, db_index=True)
    kind = models.CharField(max_length=8)  # ok | warn | err | edit | add
    title = models.CharField(max_length=300)
    by = models.CharField(max_length=150, default="system")

    class Meta:
        ordering = ["-ts", "-pk"]
