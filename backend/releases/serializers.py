import os

from django.conf import settings
from rest_framework import serializers

from .links import is_trusted_url
from .models import PLATFORM_EXTENSIONS, VERSION_RE, Channel, Platform, Release, ReleaseAsset
from .services import parse_jalali, to_jalali, update_warnings


class AssetSerializer(serializers.ModelSerializer):
    filename = serializers.SerializerMethodField()

    class Meta:
        model = ReleaseAsset
        fields = ("platform", "filename", "size", "sha256", "source_url")

    def get_filename(self, obj):
        return os.path.basename(obj.file.name)


class ReleaseSerializer(serializers.ModelSerializer):
    notes = serializers.ListField(source="notes_list", read_only=True)
    date = serializers.SerializerMethodField()
    assets = AssetSerializer(many=True, read_only=True)
    update_warnings = serializers.SerializerMethodField()

    class Meta:
        model = Release
        fields = ("id", "version", "channel", "date", "published_on", "platforms", "notes", "mandatory",
                  "rollout", "downloads", "build", "message", "maintenance", "enabled", "update_warnings",
                  "assets", "created_at")

    def get_date(self, obj):
        return to_jalali(obj.published_on)

    def get_update_warnings(self, obj):
        return update_warnings(obj)


def clean_notes(v: str) -> str:
    lines = [x.strip() for x in v.splitlines() if x.strip()]
    if not lines:
        raise serializers.ValidationError("توضیحات تغییرات را وارد کنید.")
    return "\n".join(lines)


class ReleaseUpdateSerializer(serializers.Serializer):
    """ویرایش فیلدهای update.json بعد از انتشار (پیام، حالت تعمیر، فعال بودن، …)."""

    build = serializers.IntegerField(min_value=0, max_value=2**31 - 1, required=False)
    mandatory = serializers.BooleanField(required=False)
    message = serializers.CharField(max_length=500, allow_blank=True, required=False)
    maintenance = serializers.BooleanField(required=False)
    enabled = serializers.BooleanField(required=False)
    notes = serializers.CharField(required=False)

    def validate_notes(self, v):
        return clean_notes(v)

    def validate_message(self, v):
        return v.strip()


def platform_for(filename: str):
    name = filename.lower()
    for ext, platform in PLATFORM_EXTENSIONS.items():
        if name.endswith(ext):
            return platform
    return None


class ReleaseCreateSerializer(serializers.Serializer):
    """اعتبارسنجی فرم «انتشار نسخه جدید» — همان پیام‌های طرح."""

    version = serializers.CharField(max_length=32, allow_blank=True)
    date = serializers.CharField(max_length=20)
    channel = serializers.ChoiceField(choices=Channel.choices)
    platforms = serializers.ListField(child=serializers.ChoiceField(choices=Platform.choices), allow_empty=True)
    notes = serializers.CharField(allow_blank=True)
    mandatory = serializers.BooleanField(default=False)
    rollout = serializers.ChoiceField(choices=[10, 25, 50, 100], default=100)
    files = serializers.ListField(child=serializers.FileField(), required=False, default=list)
    # فیلدهای update.json
    build = serializers.IntegerField(min_value=0, max_value=2**31 - 1, required=False, default=0)
    message = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")
    maintenance = serializers.BooleanField(default=False)
    enabled = serializers.BooleanField(default=True)
    # {"Windows": "https://…/AsanDesk-1.4.9.4-x86_64-install.exe"}؛ داشبورد فایل را از لینک می‌گیرد
    links = serializers.DictField(child=serializers.CharField(allow_blank=True), required=False, default=dict)

    def validate_version(self, v):
        v = v.strip()
        if not VERSION_RE.match(v):
            raise serializers.ValidationError("شماره نسخه معتبر نیست (مثال: 2.5.0 یا 2.5.0-beta.3)")
        if Release.objects.filter(version=v).exists():
            raise serializers.ValidationError("این شماره نسخه قبلاً منتشر شده است.")
        return v

    def validate_date(self, v):
        try:
            return parse_jalali(v)
        except ValueError:
            raise serializers.ValidationError("تاریخ انتشار معتبر نیست (مثال: ۱۴۰۵/۰۷/۰۹)")

    def validate_platforms(self, v):
        if not v:
            raise serializers.ValidationError("حداقل یک پلتفرم انتخاب کنید.")
        return list(dict.fromkeys(v))

    def validate_notes(self, v):
        return clean_notes(v)

    def validate_message(self, v):
        return v.strip()

    def validate(self, attrs):
        links = {}
        for platform, url in attrs.get("links", {}).items():
            url = url.strip()
            if not url:
                continue
            if platform not in Platform.values:
                raise serializers.ValidationError({"links": f"پلتفرم {platform} شناخته نشد."})
            if platform not in attrs["platforms"]:
                raise serializers.ValidationError({"links": f"برای {platform} لینک دادید ولی این پلتفرم انتخاب نشده."})
            if not is_trusted_url(url):
                raise serializers.ValidationError({
                    "links": f"لینک {platform} باید با https شروع شود و روی {settings.RELEASE_LINK_DOMAIN} "
                             "یا زیردامنه‌هایش باشد؛ اپلیکیشن لینک‌های دیگر را نمی‌پذیرد."
                })
            links[platform] = url
        attrs["links"] = links
        seen = {}
        for f in attrs.get("files", []):
            platform = platform_for(f.name)
            if platform is None:
                raise serializers.ValidationError({"files": f"نوع فایل {f.name} پشتیبانی نمی‌شود (exe، msi، dmg، pkg، deb، rpm، AppImage یا apk)."})
            if f.size > settings.RELEASE_MAX_FILE_SIZE:
                raise serializers.ValidationError({"files": f"حجم فایل {f.name} بیشتر از حد مجاز است."})
            if platform not in attrs["platforms"]:
                raise serializers.ValidationError({"files": f"فایل {f.name} برای {platform} است ولی این پلتفرم انتخاب نشده."})
            if platform in seen:
                raise serializers.ValidationError({"files": f"برای {platform} فقط یک فایل می‌توانید بارگذاری کنید."})
            seen[platform] = f
        for platform in links:
            if platform in seen:
                raise serializers.ValidationError({"links": f"برای {platform} هم فایل بارگذاری کردید و هم لینک دادید؛ یکی را بردارید."})
        attrs["files_by_platform"] = seen
        return attrs
