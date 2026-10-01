import os
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Channel, DownloadEvent, Release, ReleaseAsset
from .serializers import ReleaseCreateSerializer, ReleaseSerializer
from .services import file_sha256, latest_release, remember_base_url, write_manifests


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
        }
        ser = ReleaseCreateSerializer(data=data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with transaction.atomic():
            release = Release.objects.create(
                version=d["version"],
                channel=d["channel"],
                published_on=d["date"],
                platforms=d["platforms"],
                notes=d["notes"],
                mandatory=d["mandatory"],
                rollout=int(d["rollout"]),
                created_by=request.user,
            )
            for platform, f in d["files_by_platform"].items():
                ReleaseAsset.objects.create(
                    release=release, platform=platform, file=f, size=f.size, sha256=file_sha256(f)
                )
        remember_base_url(request)
        write_manifests()
        release = Release.objects.prefetch_related("assets").get(pk=release.pk)
        return Response(ReleaseSerializer(release).data, status=status.HTTP_201_CREATED)


class ReleaseStatsView(APIView):
    def get(self, request):
        stable = latest_release([Channel.STABLE])
        beta = latest_release([Channel.BETA])
        since = timezone.now() - timedelta(days=30)
        return Response({
            "latest_stable": stable.version if stable else None,
            "latest_beta": beta.version if beta else None,
            "downloads_30d": DownloadEvent.objects.filter(ts__gte=since).count(),
            # تا اتصال کلاینت‌ها به API داده‌ای از نسخه نصب‌شده نداریم
            "users_on_current": None,
            "distribution": None,
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
