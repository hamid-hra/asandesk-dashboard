import time
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from clients.views import open_ticket_count

from . import alerts, stats
from .models import Alert, AlertLevel, MetricSample, Server, hash_token
from .serializers import AlertSerializer, IngestSerializer

HW_FIELDS = ("hostname", "cores", "ram_total", "disk_total", "net_capacity_bps", "agent_version", "pubkey_fp")
_last_prune = 0.0


def prune_old_samples():
    """حذف نمونه‌های قدیمی؛ حداکثر یک بار در ساعت در هر پروسه."""
    global _last_prune
    if time.monotonic() - _last_prune < 3600 and _last_prune:
        return
    _last_prune = time.monotonic()
    cutoff = timezone.now() - timedelta(days=settings.METRICS_RETENTION_DAYS)
    MetricSample.objects.filter(ts__lt=cutoff).delete()


class IngestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        auth = request.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.startswith("Bearer ") else ""
        server = Server.objects.filter(token_hash=hash_token(token)).first() if token else None
        if server is None:
            return Response({"detail": "invalid token"}, status=status.HTTP_401_UNAUTHORIZED)

        ser = IngestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        now = timezone.now()
        ts = d.get("ts") or now
        if abs((ts - now).total_seconds()) > 300:  # ساعت agent نامعتبر است
            ts = now

        first_time = server.first_seen is None
        update = ["last_seen"]
        server.last_seen = now
        if first_time:
            server.first_seen = now
            update.append("first_seen")
        for f in HW_FIELDS:
            if f in d and getattr(server, f) != d[f]:
                setattr(server, f, d[f])
                update.append(f)
        if d.get("ip") and not server.ip:
            server.ip = d["ip"]
            update.append("ip")
        server.save(update_fields=update)

        sample = MetricSample.objects.create(
            server=server,
            ts=ts,
            **{k: d[k] for k in (
                "cpu", "ram", "ram_used", "disk", "disk_used", "net_rx_bps", "net_tx_bps",
                "net_pct", "tcp_established", "load1", "latency_ms",
            )},
        )
        if first_time:
            alerts.record_event(server, "connected", AlertLevel.INFO, "سرور جدید متصل شد",
                                f"{server.name} · اولین گزارش agent دریافت شد")
        alerts.evaluate_sample(server, sample)
        prune_old_samples()
        return Response({"ok": True}, status=status.HTTP_201_CREATED)


class OverviewView(APIView):
    def get(self, request):
        alerts.check_offline_servers()
        return Response(stats.overview(request.query_params.get("range", "7d")))


class LiveView(APIView):
    def get(self, request):
        return Response(stats.live_snapshot())


class StatusView(APIView):
    """خلاصه وضعیت برای سایدبار و زنگ اعلان."""

    def get(self, request):
        alerts.check_offline_servers()
        live = stats.live_snapshot()
        pending = Alert.objects.filter(acked_at__isnull=True)
        return Response({
            "online": live["online"],
            "total": live["total"],
            "open_crit": Alert.objects.filter(resolved_at__isnull=True, level=AlertLevel.CRIT).count(),
            "unacked": pending.count(),
            "uptime_30d": stats.uptime_30d(),
            "open_tickets": open_ticket_count(),
        })


class AlertListView(APIView):
    def get(self, request):
        alerts.check_offline_servers()
        qs = Alert.objects.filter(acked_at__isnull=True).select_related("server")[:50]
        return Response(AlertSerializer(qs, many=True).data)


class AlertAckView(APIView):
    def post(self, request, pk):
        n = Alert.objects.filter(pk=pk, acked_at__isnull=True).update(acked_at=timezone.now(), acked_by=request.user)
        if not n:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AlertAckAllView(APIView):
    def post(self, request):
        n = Alert.objects.filter(acked_at__isnull=True).update(acked_at=timezone.now(), acked_by=request.user)
        return Response({"acked": n})
