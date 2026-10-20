import time
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from clients.legacy import import_peers, mark_online
from clients.views import open_ticket_count

from . import alerts, stats
from .models import Alert, AlertLevel, MetricSample, Server, hash_token
from . import service_logs
from .serializers import AlertSerializer, IngestSerializer, LogsSerializer, OnlineSerializer, PeersSerializer

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


def server_from_token(request) -> Server | None:
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    return Server.objects.filter(token_hash=hash_token(token)).first() if token else None


class IngestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        server = server_from_token(request)
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
        if "services" in d:
            server.services, server.services_at = d["services"], now
            update += ["services", "services_at"]
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
        if "services" in d:
            alerts.evaluate_services(server, d["services"])
        prune_old_samples()
        return Response({"ok": True}, status=status.HTTP_201_CREATED)


class PeersIngestView(APIView):
    """ردیف‌های جدول peer دیتابیس hbbs از agent (دستگاه‌های قدیمی که به API گزارش نمی‌دهند)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if server_from_token(request) is None:
            return Response({"detail": "invalid token"}, status=status.HTTP_401_UNAUTHORIZED)
        ser = PeersSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        peers = {p["id"]: p for p in ser.validated_data["peers"]}
        return Response(import_peers(list(peers.values())))


def server_param(request) -> int | None:
    """?server=<شناسهٔ سرور پایش‌شده>؛ مقدار نامعتبر یعنی همه."""
    try:
        return int(request.query_params.get("server", "")) or None
    except ValueError:
        return None


class OnlineIngestView(APIView):
    """فهرست دستگاه‌های آنلاین در hbbs (agent با حالت شنود). فقط دستگاه‌های قدیمی را «همین الان دیده شد» می‌کند."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        server = server_from_token(request)
        if server is None:
            return Response({"detail": "invalid token"}, status=status.HTTP_401_UNAUTHORIZED)
        ser = OnlineSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        server.peers_online_at = timezone.now()
        server.save(update_fields=["peers_online_at"])
        return Response({"online": mark_online(list(set(ser.validated_data["ids"])))})


class LogsIngestView(APIView):
    """خط‌های تازهٔ لاگ کانتینرهای hbbs/hbbr از agent."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        server = server_from_token(request)
        if server is None:
            return Response({"detail": "invalid token"}, status=status.HTTP_401_UNAUTHORIZED)
        ser = LogsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return Response({"stored": service_logs.store(server, ser.validated_data["services"])})


class OverviewView(APIView):
    def get(self, request):
        alerts.check_offline_servers()
        return Response(stats.overview(request.query_params.get("range", "7d"), server_param(request)))


class LiveView(APIView):
    def get(self, request):
        return Response(stats.live_snapshot(server_param(request)))


class StatusView(APIView):
    """خلاصه وضعیت برای سایدبار و زنگ اعلان."""

    def get(self, request):
        alerts.check_offline_servers()
        live = stats.live_snapshot()
        shown = alerts.visible_alerts()
        pending = shown.filter(acked_at__isnull=True)
        return Response({
            "online": live["online"],
            "total": live["total"],
            "open_crit": shown.filter(resolved_at__isnull=True, level=AlertLevel.CRIT).count(),
            "unacked": pending.count(),
            "uptime_30d": stats.uptime_30d(),
            "open_tickets": open_ticket_count(),
        })


class AlertListView(APIView):
    def get(self, request):
        alerts.check_offline_servers()
        qs = alerts.visible_alerts().filter(acked_at__isnull=True).select_related("server")[:50]
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
