"""حساب‌های «آسان دسک وب» (web.asandesk.ir).

این حساب‌ها از کاربران پنل (accounts.User) و حساب‌های داخل اپلیکیشن (clients.Account) جدا هستند:
کاربر وب هیچ راهی به پنل ندارد و ورودش کوکی جداگانهٔ خودش را دارد (auth.py).

هر حساب یک «کد» ثابت دارد (web_id) که دیگران برای دیدن صفحهٔ او وارد می‌کنند. درگاه وب (webgw) همین کد را
با uuid و کلید عمومی حساب در سرور شناسه (hbbs) ثبت می‌کند؛ کلید خصوصی (sign_seed) فقط به مرورگر خود کاربر
داده می‌شود تا در دست‌دادن رمزنگاری هویتش را امضا کند.
"""

import base64
import hashlib
import secrets

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone

# کد کاربران وب ده رقمی و با ۳ شروع می‌شود. شناسه‌ای که خود برنامهٔ دسکتاپ می‌سازد حداکثر 0x1FFFFFFF
# (۹ رقم) یا روی موبایل بین ۱ تا ۲ میلیارد است، پس این بازه با شناسهٔ خودکار هیچ دستگاهی برخورد نمی‌کند.
WEB_ID_MIN = 3_000_000_000
WEB_ID_MAX = 3_999_999_999


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def new_web_id() -> str:
    while True:
        candidate = str(WEB_ID_MIN + secrets.randbelow(WEB_ID_MAX - WEB_ID_MIN + 1))
        if not WebUser.objects.filter(web_id=candidate).exists():
            return candidate


def new_peer_keys() -> tuple[str, str]:
    """(seed, public key) جفت‌کلید Ed25519 به base64؛ همان قالبی که برنامه و hbbs به کار می‌برند."""
    sk = Ed25519PrivateKey.generate()
    seed = sk.private_bytes_raw()
    pk = sk.public_key().public_bytes_raw()
    return b64(seed), b64(pk)


class WebUser(models.Model):
    first_name = models.CharField("نام", max_length=64)
    last_name = models.CharField("نام خانوادگی", max_length=64)
    # نام کاربری، ایمیل و موبایل هر سه برای ورود پذیرفته می‌شوند؛ همه به شکل یکسان‌شده ذخیره می‌شوند
    username = models.CharField("نام کاربری", max_length=32, unique=True)
    email = models.CharField("ایمیل", max_length=254, unique=True)
    phone = models.CharField("موبایل", max_length=16, unique=True)
    # هش رمز با الگوریتم پیش‌فرض Django (PBKDF2)؛ خود رمز هرگز ذخیره نمی‌شود
    password = models.CharField("رمز عبور", max_length=128)

    web_id = models.CharField("کد اتصال", max_length=16, unique=True)
    peer_uuid = models.CharField(max_length=64, editable=False)
    sign_seed = models.CharField(max_length=64, editable=False)
    sign_pk = models.CharField(max_length=64, editable=False)

    is_blocked = models.BooleanField("مسدود", default=False)
    created_at = models.DateTimeField("زمان ثبت‌نام", default=timezone.now, db_index=True)
    last_login_at = models.DateTimeField("آخرین ورود", null=True, blank=True)
    last_seen_at = models.DateTimeField("آخرین فعالیت", null=True, blank=True)
    last_ip = models.CharField("آخرین IP", max_length=64, blank=True)
    signup_ip = models.CharField("IP ثبت‌نام", max_length=64, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "کاربر وب"
        verbose_name_plural = "کاربران وب"

    def __str__(self):
        return f"{self.full_name} ({self.username})"

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def set_password(self, raw: str):
        self.password = make_password(raw)

    def check_password(self, raw: str) -> bool:
        return check_password(raw, self.password)

    def ensure_identity(self):
        """کد، uuid و کلید حساب تازه را می‌سازد (قبل از اولین ذخیره صدا زده می‌شود)."""
        if not self.web_id:
            self.web_id = new_web_id()
        if not self.peer_uuid:
            self.peer_uuid = b64(secrets.token_bytes(16))
        if not self.sign_seed or not self.sign_pk:
            self.sign_seed, self.sign_pk = new_peer_keys()


class WebSession(models.Model):
    """یک ورود در یک مرورگر. خود توکن فقط در کوکی کاربر است؛ این‌جا هش آن نگه داشته می‌شود."""

    user = models.ForeignKey(WebUser, on_delete=models.CASCADE, related_name="sessions")
    key_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_used_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(db_index=True)
    ip = models.CharField(max_length=64, blank=True)
    user_agent = models.CharField(max_length=200, blank=True)

    @classmethod
    def issue(cls, user: WebUser, lifetime, ip: str, user_agent: str) -> tuple["WebSession", str]:
        raw = secrets.token_urlsafe(32)
        now = timezone.now()
        session = cls.objects.create(
            user=user, key_hash=sha256(raw), created_at=now, last_used_at=now, expires_at=now + lifetime,
            ip=ip[:64], user_agent=user_agent[:200],
        )
        return session, raw


class WebDevice(models.Model):
    """دستگاه‌هایی که کاربر از وب به آن‌ها وصل شده (فهرست «دستگاه‌های شما» در هر مرورگری که وارد شود)."""

    user = models.ForeignKey(WebUser, on_delete=models.CASCADE, related_name="devices")
    peer_id = models.CharField(max_length=32)
    name = models.CharField(max_length=128, blank=True)
    platform = models.CharField(max_length=32, blank=True)
    favorite = models.BooleanField(default=False)
    last_connected_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-last_connected_at"]
        constraints = [models.UniqueConstraint(fields=["user", "peer_id"], name="webdevice_user_peer")]


class Direction(models.TextChoices):
    OUT = "out", "کنترل دستگاه دیگر"
    IN = "in", "اشتراک صفحه"


class WebConnection(models.Model):
    """گزارش اتصال‌های کاربر وب برای پشتیبانی (چه وقت، به کدام کد، در کدام جهت)."""

    user = models.ForeignKey(WebUser, on_delete=models.CASCADE, related_name="connections")
    direction = models.CharField(max_length=3, choices=Direction.choices)
    peer_id = models.CharField(max_length=32, blank=True)
    peer_name = models.CharField(max_length=128, blank=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    ip = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-started_at"]
