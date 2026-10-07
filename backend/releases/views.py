import json
import os
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from clients.stats import version_distribution

from .links import LinkError, fetch_installer, platform_of_name
from .models import Channel, DownloadEvent, Release, ReleaseAsset
from .serializers import ReleaseCreateSerializer, ReleaseSerializer, ReleaseUpdateSerializer
from .services import file_sha256, latest_release, remember_base_url, update_json_bytes, write_manifests


def parse_links(raw) -> dict:
    """فیلد links فرم (رشتهٔ JSON) یا دیکشنری JSON."""
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        raise ValidationError({"links": "لینک‌ها معتبر نیستند."})
    if not isinstance(data, dict):
        raise ValidationError({"links": "لینک‌ها معتبر نیستند."})
    return {str(k): str(v) for k, v in data.items()}


class ReleaseListView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        qs = Release.objects.prefetch_related("assets")
        channel = request.query_params.get("channel")
        if channel in Channel.values:
            qs = qs.filter(channel=channel)
        return Response(ReleaseSerializer(qs, many=True).data)

    def post(self, request):
        data = {
            "version": request.data.get("version", ""),
            "date": request.data.get("date", ""),
            "channel": request.data.get("channel", Channel.STABLE),
            "platforms": request.data.getlist("platforms") if hasattr(request.data, "getlist") else request.data.get("platforms", []),
            "notes": request.data.get("notes", ""),
            "mandatory": request.data.get("mandatory", False),
            "rollout": request.data.get("rollout", 100),
            "files": request.FILES.getlist("files"),
            "build": request.data.get("build") or 0,
            "message": request.data.get("message", ""),
            "maintenance": request.data.get("maintenance", False),
            "enabled": request.data.get("enabled", True),
            "links": parse_links(request.data.get("links")),
        }
        ser = ReleaseCreateSerializer(data=data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        # فایل‌ها را از لینک‌ها بگیر (پیش از ساخت رکورد؛ هر خطایی چیزی ذخیره نمی‌کند)
        downloaded = {}
        try:
            for platform, url in d["links"].items():
                try:
                    downloaded[platform] = fetch_installer(url)
                except LinkError as e:
                    raise ValidationError({"links": f"{platform}: {e}"})
                if platform_of_name(downloaded[platform].name) != platform:
                    raise ValidationError({"links": f"فایل لینک {platform} برای {platform} نیست ({downloaded[platform].name})."})
            with transaction.atomic():
                release = Release.objects.create(
                    version=d["version"],
                    channel=d["channel"],
                    published_on=d["date"],
                    platforms=d["platforms"],
                    notes=d["notes"],
                    mandatory=d["mandatory"],
                    rollout=int(d["rollout"]),
                    build=d["build"],
                    message=d["message"],
                    maintenance=d["maintenance"],
                    enabled=d["enabled"],
                    created_by=request.user,
                )
                for platform, f in d["files_by_platform"].items():
                    ReleaseAsset.objects.create(
                        release=release, platform=platform, file=f, size=f.size, sha256=file_sha256(f)
                    )
                for platform, f in downloaded.items():
                    ReleaseAsset.objects.create(
                        release=release, platform=platform, file=f, size=f.size, sha256=f.sha256,
                        source_url=d["links"][platform],
                    )
        finally:
            for f in downloaded.values():
                f.close()
        remember_base_url(request)
        write_manifests()
        release = Release.objects.prefetch_related("assets").get(pk=release.pk)
        return Response(ReleaseSerializer(release).data, status=status.HTTP_201_CREATED)


class ReleaseDetailView(APIView):
    """ویرایش فیلدهای update.json یک نسخهٔ منتشرشده (پیام، حالت تعمیر، فعال بودن، …)."""

    parser_classes = [JSONParser]

    def get(self, request, version):
        release = get_object_or_404(Release.objects.prefetch_related("assets"), version=version)
        return Response(ReleaseSerializer(release).data)

    def patch(self, request, version):
        release = get_object_or_404(Release.objects.prefetch_related("assets"), version=version)
        ser = ReleaseUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        for field, value in ser.validated_data.items():
            setattr(release, field, value)
        release.save(update_fields=list(ser.validated_data) or None)
        write_manifests()
        return Response(ReleaseSerializer(release).data)


class UpdateJsonView(APIView):
    """update.json همین نسخه برای دانلود (به CDN بالا بگذارید؛ اپلیکیشن آن را می‌خواند)."""

    def get(self, request, version):
        release = get_object_or_404(Release.objects.prefetch_related("assets"), version=version)
        remember_base_url(request)
        resp = HttpResponse(update_json_bytes(release), content_type="application/json; charset=utf-8")
        resp["Content-Disposition"] = 'attachment; filename="update.json"'
        resp["Cache-Control"] = "private, no-store"
        return resp


class ReleaseStatsView(APIView):
    def get(self, request):
        stable = latest_release([Channel.STABLE])
        beta = latest_release([Channel.BETA])
        since = timezone.now() - timedelta(days=30)
        on_current, distribution = version_distribution()
        return Response({
            "latest_stable": stable.version if stable else None,
            "latest_beta": beta.version if beta else None,
            "downloads_30d": DownloadEvent.objects.filter(ts__gte=since).count(),
            # از نسخه‌ای که کلاینت‌های فعال ۳۰ روز اخیر در sysinfo گزارش داده‌اند
            "users_on_current": on_current,
            "distribution": distribution,
        })


def download(request, version, platform, filename=None):
    """دانلود عمومی فایل نصب + شمارش. پشت nginx فایل با X-Accel-Redirect فرستاده می‌شود.

    `filename` فقط برای این است که آدرس به نام فایل ختم شود (آپدیت خودکار کلاینت)؛
    فایل واقعی از روی version+platform پیدا می‌شود.
    """
    asset = (
        ReleaseAsset.objects.select_related("release")
        .filter(release__version=version, platform__iexact=platform)
        .first()
    )
    if asset is None or not asset.file:
        raise Http404
    Release.objects.filter(pk=asset.release_id).update(downloads=F("downloads") + 1)
    DownloadEvent.objects.create(release_id=asset.release_id, platform=asset.platform)
    filename = os.path.basename(asset.file.name)
    if settings.USE_X_ACCEL_REDIRECT:
        resp = HttpResponse()
        resp["X-Accel-Redirect"] = settings.X_ACCEL_PREFIX + asset.file.name
        resp["Content-Type"] = "application/octet-stream"
        resp["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp
    return FileResponse(asset.file.open("rb"), as_attachment=True, filename=filename)
