import os

from django.conf import settings
from rest_framework import serializers

from .models import PLATFORM_EXTENSIONS, VERSION_RE, Channel, Platform, Release, ReleaseAsset
from .services import parse_jalali, to_jalali


class AssetSerializer(serializers.ModelSerializer):
    filename = serializers.SerializerMethodField()

    class Meta:
        model = ReleaseAsset
        fields = ("platform", "filename", "size", "sha256")

    def get_filename(self, obj):
        return os.path.basename(obj.file.name)


class ReleaseSerializer(serializers.ModelSerializer):
    notes = serializers.ListField(source="notes_list", read_only=True)
    date = serializers.SerializerMethodField()
    assets = AssetSerializer(many=True, read_only=True)

    class Meta:
        model = Release
        fields = ("id", "version", "channel", "date", "published_on", "platforms", "notes", "mandatory",
                  "rollout", "downloads", "assets", "created_at")

    def get_date(self, obj):
        return to_jalali(obj.published_on)


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
        lines = [x.strip() for x in v.splitlines() if x.strip()]
        if not lines:
            raise serializers.ValidationError("توضیحات تغییرات را وارد کنید.")
        return "\n".join(lines)

    def validate(self, attrs):
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
        attrs["files_by_platform"] = seen
        return attrs
