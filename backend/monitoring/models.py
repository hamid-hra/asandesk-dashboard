import hashlib
import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Server(models.Model):
    """سروری که agent روی آن اجرا می‌شود و منابعش را گزارش می‌دهد."""

    name = models.CharField("نام", max_length=64, unique=True)
    region = models.CharField("منطقه", max_length=64, blank=True)
    ip = models.CharField("IP", max_length=64, blank=True)
    hostname = models.CharField("hostname", max_length=128, blank=True, editable=False)
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    maintenance = models.BooleanField("در حال نگهداری", default=False)
    # مشخصات سخت‌افزار (agent گزارش می‌دهد)
    cores = models.PositiveIntegerField(default=0, editable=False)
    ram_total = models.BigIntegerField(default=0, editable=False)
    disk_total = models.BigIntegerField(default=0, editable=False)
    net_capacity_bps = models.BigIntegerField(default=0, editable=False)
    agent_version = models.CharField(max_length=32, blank=True, editable=False)
    first_seen = models.DateTimeField(null=True, blank=True, editable=False)
    last_seen = models.DateTimeField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "سرور"
        verbose_name_plural = "سرورها"

    def __str__(self):
        return self.name

    def set_token(self, token: str | None = None) -> str:
        token = token or secrets.token_urlsafe(32)
        self.token_hash = hash_token(token)
        return token

    @property
    def online(self) -> bool:
        if not self.last_seen:
            return False
        age = (timezone.now() - self.last_seen).total_seconds()
        return age <= settings.SERVER_OFFLINE_AFTER_SECONDS


class MetricSample(models.Model):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="samples")
    ts = models.DateTimeField(db_index=True)
    cpu = models.FloatField()  # درصد
    ram = models.FloatField()  # درصد
    ram_used = models.BigIntegerField(default=0)
    disk = models.FloatField()  # درصد
    disk_used = models.BigIntegerField(default=0)
    net_rx_bps = models.BigIntegerField(default=0)
    net_tx_bps = models.BigIntegerField(default=0)
    net_pct = models.FloatField(default=0)  # درصد از ظرفیت لینک
    tcp_established = models.PositiveIntegerField(default=0)
    load1 = models.FloatField(default=0)
    latency_ms = models.FloatField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["server", "ts"])]
        ordering = ["ts"]


class AlertLevel(models.TextChoices):
    CRIT = "crit", "بحرانی"
    WARN = "warn", "هشدار"
    INFO = "info", "اطلاع"


class Alert(models.Model):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="alerts", null=True, blank=True)
    level = models.CharField(max_length=8, choices=AlertLevel.choices)
    kind = models.CharField(max_length=32)
    title = models.CharField(max_length=200)
    detail = models.CharField(max_length=300, blank=True)
    opened_at = models.DateTimeField(default=timezone.now, db_index=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    acked_at = models.DateTimeField(null=True, blank=True)
    acked_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-opened_at"]
        verbose_name = "هشدار"
        verbose_name_plural = "هشدارها"
        constraints = [
            # برای هر سرور از هر نوع، حداکثر یک هشدار باز
            models.UniqueConstraint(
                fields=["server", "kind"],
                condition=models.Q(resolved_at__isnull=True),
                name="one_open_alert_per_kind",
            )
        ]

    def __str__(self):
        return self.title
