from django.contrib.auth.models import AbstractUser, UserManager as BaseUserManager
from django.db import models


class Role(models.TextChoices):
    OWNER = "owner", "مالک"
    ADMIN = "admin", "مدیر"
    VIEWER = "viewer", "ناظر"
    CUSTOM = "custom", "سفارشی"


# بخش‌های پنل که دسترسی هر کدام جدا تعیین می‌شود
SECTIONS = ("server", "release", "clients", "tickets", "ads", "users", "backup", "ha", "activity", "system")
LEVELS = ("none", "view", "edit")

# «system» (به‌روزرسانی پنل و لاگ داکر) فقط مال مالک است و به هیچ نقش یا کاربری داده نمی‌شود.
OWNER_ONLY = ("system",)
# «activity» (لاگ فعالیت‌ها) فقط مشاهده دارد؛ «ویرایش» همان «مشاهده» حساب می‌شود.
VIEW_ONLY = ("activity",)
# بخش‌هایی که مالک می‌تواند به یک «مدیر» یا «ناظر» جداگانه بدهد، بدون اینکه نقشش «سفارشی» شود.
EXTRA_SECTIONS = ("activity",)

# دسترسی پیش‌فرض نقش‌ها؛ برای نقش «سفارشی» از فیلد perms خوانده می‌شود.
# بخش‌های حساس (کاربران، پشتیبان‌گیری، HA، لاگ فعالیت، سیستم) برای مدیر و ناظر «بدون دسترسی» است:
# یک پشتیبان یعنی کپی کل دیتابیس. مالک می‌تواند با نقش «سفارشی» به کسی بدهد.
PRESETS = {
    Role.OWNER: dict.fromkeys(SECTIONS, "edit"),
    Role.ADMIN: {
        "server": "edit", "release": "edit", "clients": "edit", "tickets": "edit", "ads": "edit",
        "users": "none", "backup": "none", "ha": "none", "activity": "none", "system": "none",
    },
    Role.VIEWER: {
        "server": "view", "release": "view", "clients": "view", "tickets": "view", "ads": "view",
        "users": "none", "backup": "none", "ha": "none", "activity": "none", "system": "none",
    },
}


def clean_perms(perms) -> dict:
    """فقط بخش‌ها و سطح‌های شناخته‌شده؛ بقیه «بدون دسترسی»."""
    perms = perms if isinstance(perms, dict) else {}
    out = {k: (perms.get(k) if perms.get(k) in LEVELS else "none") for k in SECTIONS}
    for k in OWNER_ONLY:
        out[k] = "none"
    for k in VIEW_ONLY:
        if out[k] == "edit":
            out[k] = "view"
    return out


def clean_extras(perms) -> dict:
    """دسترسی‌های جداگانهٔ یک مدیر/ناظر روی نقشش (فقط EXTRA_SECTIONS و فقط «مشاهده»)."""
    perms = perms if isinstance(perms, dict) else {}
    return {k: "view" for k in EXTRA_SECTIONS if perms.get(k) in ("view", "edit")}


class UserManager(BaseUserManager):
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault("role", Role.OWNER)
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    """کاربر پنل. دسترسی‌ها فقط از روی `role` تعیین می‌شوند.

    - owner: همه چیز، به‌علاوه مدیریت کاربران در /admin
    - admin: انتشار نسخه و بررسی هشدارها
    - viewer: فقط مشاهده
    """

    role = models.CharField("نقش", max_length=16, choices=Role.choices, default=Role.VIEWER)
    # نقش «سفارشی»: {بخش: none|view|edit}. مدیر/ناظر: فقط دسترسی‌های اضافه، مثل {"activity": "view"}
    perms = models.JSONField("دسترسی بخش‌ها", default=dict, blank=True)
    # رمز را کس دیگری گذاشته (ساخت حساب یا «تغییر رمز» توسط مالک)؛ تا خود کاربر رمز تازه نگذارد پنل کار نمی‌کند
    must_change_password = models.BooleanField("باید رمز را عوض کند", default=False)

    objects = UserManager()

    class Meta:
        verbose_name = "کاربر"
        verbose_name_plural = "کاربران"

    def save(self, *args, **kwargs):
        # فقط مالک به پنل Django (مدیریت کاربران) دسترسی دارد
        is_owner = self.role == Role.OWNER
        self.is_staff = is_owner
        self.is_superuser = is_owner
        super().save(*args, **kwargs)

    def resolved_perms(self) -> dict:
        """دسترسی نهایی هر بخش (غیرفعال = هیچ‌چیز)."""
        if not self.is_active:
            return dict.fromkeys(SECTIONS, "none")
        if self.role == Role.CUSTOM:
            return clean_perms(self.perms)
        perms = dict(PRESETS.get(self.role, PRESETS[Role.VIEWER]))
        if self.role in (Role.ADMIN, Role.VIEWER):
            perms.update(clean_extras(self.perms))
        return perms

    def level(self, section: str) -> str:
        return self.resolved_perms().get(section, "none")

    @property
    def can_manage(self):
        """ویرایش حداقل یکی از بخش‌های عملیاتی (برای سازگاری با رابط قدیمی)."""
        return self.is_active and any(self.level(k) == "edit" for k in ("release", "clients", "tickets", "server"))

    @property
    def display_name(self):
        return self.get_full_name() or self.username


class RecoveryCode(models.Model):
    """One-time code that lets a user who forgot the password set a new one (see recovery.py).

    Only an HMAC of the code is stored, never the code itself.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="recovery_codes")
    code_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "کد بازیابی"
        verbose_name_plural = "کدهای بازیابی"
