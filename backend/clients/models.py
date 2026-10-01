import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class Plan(models.TextChoices):
    FREE = "free", "رایگان"
    PRO = "pro", "حرفه‌ای"


class Account(models.Model):
    """حساب کاربری اپلیکیشن آسان‌دسک (ورود از داخل کلاینت). مالک از /admin می‌سازد."""

    email = models.EmailField("ایمیل", unique=True)
    name = models.CharField("نام", max_length=100, blank=True)
    password = models.CharField("رمز عبور", max_length=128)
    plan = models.CharField("طرح", max_length=8, choices=Plan.choices, default=Plan.FREE)
    is_active = models.BooleanField("فعال", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ["email"]
        verbose_name = "حساب کاربری اپلیکیشن"
        verbose_name_plural = "حساب‌های کاربری اپلیکیشن"

    def __str__(self):
        return self.name or self.email

    def set_password(self, raw: str):
        self.password = make_password(raw)

    def check_password(self, raw: str) -> bool:
        return check_password(raw, self.password)

    @property
    def display_name(self):
        return self.name or self.email.split("@")[0]


PLATFORMS = ("Windows", "macOS", "Linux", "Android", "iOS")


def platform_of(os_name: str) -> str:
    s = (os_name or "").lower()
    if "windows" in s:
        return "Windows"
    if "android" in s:
        return "Android"
    if "mac" in s or "darwin" in s:
        return "macOS"
    if "ios" in s or "iphone" in s or "ipad" in s:
        return "iOS"
    if s:
        return "Linux"
    return ""


class Client(models.Model):
    """دستگاهی که آسان‌دسک روی آن نصب است و با API سرور (heartbeat/sysinfo) گزارش می‌دهد."""

    rd_id = models.CharField("شناسه", max_length=32, unique=True)
    # uuid دستگاه در اولین تماس ثبت می‌شود؛ تماس‌های بعدی با همان شناسه باید همان uuid را داشته باشند
    uuid_hash = models.CharField(max_length=64, blank=True, editable=False)
    hostname = models.CharField("نام دستگاه", max_length=128, blank=True)
    os_user = models.CharField("کاربر سیستم‌عامل", max_length=128, blank=True)
    os = models.CharField("سیستم‌عامل", max_length=200, blank=True)
    cpu = models.CharField("پردازنده", max_length=200, blank=True)
    memory = models.CharField("حافظه", max_length=32, blank=True)
    version = models.CharField("نسخه برنامه", max_length=32, blank=True)
    ip = models.CharField("IP", max_length=64, blank=True)
    account = models.ForeignKey(
        Account, verbose_name="حساب واردشده", null=True, blank=True, on_delete=models.SET_NULL, related_name="clients"
    )
    blocked = models.BooleanField("مسدود", default=False)
    first_seen = models.DateTimeField("اولین تماس", default=timezone.now)
    last_seen = models.DateTimeField("آخرین تماس", null=True, blank=True)
    sysinfo_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ["-last_seen"]
        verbose_name = "کلاینت"
        verbose_name_plural = "کلاینت‌ها"

    def __str__(self):
        return f"{self.rd_id} ({self.display_name})"

    def check_uuid(self, uuid: str) -> bool:
        return bool(uuid) and secrets.compare_digest(self.uuid_hash, sha256(uuid))

    @property
    def online(self) -> bool:
        if not self.last_seen:
            return False
        return (timezone.now() - self.last_seen).total_seconds() <= settings.CLIENT_OFFLINE_AFTER_SECONDS

    @property
    def platform(self) -> str:
        return platform_of(self.os)

    @property
    def display_name(self) -> str:
        if self.account_id:
            return self.account.display_name
        return self.hostname or self.rd_id


class AccessToken(models.Model):
    """توکن ورود کلاینت به حساب (Bearer). خروج اجباری = حذف توکن‌های دستگاه."""

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="tokens")
    client = models.ForeignKey(Client, null=True, blank=True, on_delete=models.CASCADE, related_name="tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @classmethod
    def issue(cls, account: Account, client: Client | None) -> str:
        token = secrets.token_urlsafe(32)
        cls.objects.create(account=account, client=client, token_hash=sha256(token))
        return token


class ConnType(models.IntegerChoices):
    DESKTOP = 0, "ریموت دسکتاپ"
    FILE = 1, "انتقال فایل"
    PORT_FORWARD = 2, "انتقال پورت"
    CAMERA = 3, "دوربین"
    TERMINAL = 4, "ترمینال"


class ConnSession(models.Model):
    """یک اتصال ریموت، از گزارش audit/conn کلاینتِ کنترل‌شونده."""

    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="incoming")
    conn_id = models.IntegerField()
    session_id = models.CharField(max_length=24, blank=True)
    # کنترل‌کننده (شناسه و نام دستگاهی که وصل شده)
    peer_id = models.CharField(max_length=32, blank=True, db_index=True)
    peer_name = models.CharField(max_length=128, blank=True)
    conn_type = models.SmallIntegerField(null=True, blank=True)
    ip = models.CharField(max_length=64, blank=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    # null = احراز هویت انجام نشد (رمز اشتباه، لغو و …)
    authorized_at = models.DateTimeField(null=True, blank=True, db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["client", "conn_id", "ended_at"])]

    @property
    def duration(self) -> timedelta:
        if not self.authorized_at:
            return timedelta(0)
        return max(timedelta(0), (self.ended_at or timezone.now()) - self.authorized_at)


class TicketStatus(models.TextChoices):
    OPEN = "open", "باز"
    PENDING = "pending", "در انتظار کاربر"
    CLOSED = "closed", "بسته"


class Priority(models.TextChoices):
    URGENT = "urgent", "فوری"
    HIGH = "high", "بالا"
    NORMAL = "normal", "عادی"
    LOW = "low", "کم"


TICKET_NUMBER_BASE = 1000


class Ticket(models.Model):
    client = models.ForeignKey(Client, verbose_name="کلاینت", on_delete=models.CASCADE, related_name="tickets")
    subject = models.CharField("موضوع", max_length=200)
    category = models.CharField("دسته", max_length=64, blank=True)
    priority = models.CharField("اولویت", max_length=8, choices=Priority.choices, default=Priority.NORMAL)
    status = models.CharField("وضعیت", max_length=8, choices=TicketStatus.choices, default=TicketStatus.OPEN)
    # اطلاعاتی که کلاینت خودکار پیوست می‌کند (نسخه، سیستم‌عامل، کیفیت شبکه …)
    diag = models.CharField("اطلاعات پیوست", max_length=300, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    first_response_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "تیکت"
        verbose_name_plural = "تیکت‌ها"

    def __str__(self):
        return f"{self.code} {self.subject}"

    @property
    def code(self) -> str:
        return f"T-{TICKET_NUMBER_BASE + self.pk}"

    def set_status(self, status: str):
        self.status = status
        self.closed_at = timezone.now() if status == TicketStatus.CLOSED else None


class TicketMessage(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="messages")
    from_client = models.BooleanField(default=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    text = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at", "pk"]
