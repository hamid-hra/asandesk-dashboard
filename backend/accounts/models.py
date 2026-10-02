from django.contrib.auth.models import AbstractUser, UserManager as BaseUserManager
from django.db import models


class Role(models.TextChoices):
    OWNER = "owner", "مالک"
    ADMIN = "admin", "مدیر"
    VIEWER = "viewer", "ناظر"
    CUSTOM = "custom", "سفارشی"


# بخش‌های پنل که دسترسی هر کدام جدا تعیین می‌شود
SECTIONS = ("server", "release", "clients", "tickets", "ads", "announce", "users", "backup", "ha")
LEVELS = ("none", "view", "edit")

# دسترسی پیش‌فرض نقش‌ها؛ برای نقش «سفارشی» از فیلد perms خوانده می‌شود
PRESETS = {
    Role.OWNER: dict.fromkeys(SECTIONS, "edit"),
    Role.ADMIN: {
        "server": "edit", "release": "edit", "clients": "edit", "tickets": "edit", "ads": "edit",
        "announce": "edit", "users": "none", "backup": "view", "ha": "view",
    },
    Role.VIEWER: {
        "server": "view", "release": "view", "clients": "view", "tickets": "view", "ads": "view",
        "announce": "view", "users": "none", "backup": "view", "ha": "view",
    },
}


def clean_perms(perms) -> dict:
    """فقط بخش‌ها و سطح‌های شناخته‌شده؛ بقیه «بدون دسترسی»."""
    perms = perms if isinstance(perms, dict) else {}
    return {k: (perms.get(k) if perms.get(k) in LEVELS else "none") for k in SECTIONS}


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
    # فقط برای نقش «سفارشی»: {بخش: none|view|edit}
    perms = models.JSONField("دسترسی بخش‌ها", default=dict, blank=True)

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
        return dict(PRESETS.get(self.role, PRESETS[Role.VIEWER]))

    def level(self, section: str) -> str:
        return self.resolved_perms().get(section, "none")

    @property
    def can_manage(self):
        """ویرایش حداقل یکی از بخش‌های عملیاتی (برای سازگاری با رابط قدیمی)."""
        return self.is_active and any(self.level(k) == "edit" for k in ("release", "clients", "tickets", "server"))

    @property
    def display_name(self):
        return self.get_full_name() or self.username
