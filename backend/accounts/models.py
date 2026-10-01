from django.contrib.auth.models import AbstractUser, UserManager as BaseUserManager
from django.db import models


class Role(models.TextChoices):
    OWNER = "owner", "مالک"
    ADMIN = "admin", "مدیر"
    VIEWER = "viewer", "ناظر"


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

    @property
    def can_manage(self):
        return self.is_active and self.role in (Role.OWNER, Role.ADMIN)

    @property
    def display_name(self):
        return self.get_full_name() or self.username
