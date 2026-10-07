import re

from django.conf import settings
from django.db import models

# سه یا چهار بخش عددی (آسان‌دسک 1.4.9.4 چهاربخشی است) و پسوند پیش‌انتشار اختیاری
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(\.\d+)?(-[a-z]+\.?\d*)?$", re.IGNORECASE)


class Channel(models.TextChoices):
    STABLE = "stable", "پایدار"
    BETA = "beta", "بتا"


class Platform(models.TextChoices):
    WINDOWS = "Windows", "Windows"
    MACOS = "macOS", "macOS"
    LINUX = "Linux", "Linux"
    ANDROID = "Android", "Android"


PLATFORM_EXTENSIONS = {
    ".exe": Platform.WINDOWS,
    ".msi": Platform.WINDOWS,
    ".dmg": Platform.MACOS,
    ".pkg": Platform.MACOS,
    ".deb": Platform.LINUX,
    ".rpm": Platform.LINUX,
    ".appimage": Platform.LINUX,
    ".apk": Platform.ANDROID,
}


def version_key(version: str):
    """کلید مرتب‌سازی: 2.5.0 > 2.5.0-beta.3 > 2.5.0-beta.2 > 2.4.1"""
    core, _, pre = version.partition("-")
    nums = tuple(int(x) for x in core.split("."))
    if not pre:
        return nums, 1, "", 0
    m = re.match(r"([a-z]+)\.?(\d*)", pre, re.IGNORECASE)
    tag, n = (m.group(1).lower(), int(m.group(2) or 0)) if m else (pre, 0)
    return nums, 0, tag, n


class Release(models.Model):
    version = models.CharField("نسخه", max_length=32, unique=True)
    channel = models.CharField("کانال", max_length=8, choices=Channel.choices, default=Channel.STABLE)
    published_on = models.DateField("تاریخ انتشار")
    platforms = models.JSONField("پلتفرم‌ها", default=list)
    notes = models.TextField("توضیحات تغییرات")
    mandatory = models.BooleanField("اجباری", default=False)
    rollout = models.PositiveSmallIntegerField("انتشار تدریجی (٪)", default=100)
    downloads = models.PositiveIntegerField("دانلود", default=0)
    # فیلدهای فایل update.json که اپلیکیشن می‌خواند (mandatory همان force_update است)
    build = models.PositiveIntegerField("شمارهٔ بیلد", default=0)
    message = models.CharField("پیام به کاربران", max_length=500, blank=True)
    maintenance = models.BooleanField("حالت تعمیر", default=False)
    enabled = models.BooleanField("فعال", default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-published_on", "-created_at"]
        verbose_name = "نسخه"
        verbose_name_plural = "نسخه‌ها"

    def __str__(self):
        return self.version

    @property
    def notes_list(self):
        return [line.strip() for line in self.notes.splitlines() if line.strip()]


def asset_upload_to(instance, filename):
    return f"files/{instance.release.version}/{filename}"


class ReleaseAsset(models.Model):
    release = models.ForeignKey(Release, on_delete=models.CASCADE, related_name="assets")
    platform = models.CharField(max_length=16, choices=Platform.choices)
    file = models.FileField(upload_to=asset_upload_to, max_length=255)
    size = models.BigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True)
    # لینکی که مالک داده و داشبورد فایل را از آن گرفته؛ در update.json همین لینک می‌آید
    source_url = models.URLField(max_length=500, blank=True)

    class Meta:
        unique_together = [("release", "platform")]
        ordering = ["platform"]


class DownloadEvent(models.Model):
    release = models.ForeignKey(Release, on_delete=models.CASCADE, related_name="download_events")
    platform = models.CharField(max_length=16)
    ts = models.DateTimeField(auto_now_add=True, db_index=True)
