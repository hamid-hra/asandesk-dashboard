"""ویوهای کلاینت‌ها.

دو گروه:
- ویوهای «دریافت» که خود کلاینت آسان دسک صدا می‌زند (heartbeat/sysinfo/audit).
  اینها احراز هویت کاربری ندارند؛ کلاینت با (id, uuid) شناخته می‌شود. شکل درخواست
  همان پروتکل داخلی کلاینت است، پس هیچ تغییری در کلاینت لازم نیست.
- ویوهای «پنل» که تیم پشتیبانی پشت لاگین می‌بیند (فهرست، جزئیات، قطع، مسدودسازی).
"""

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import ReadOnlyForViewer
from .geoip import lookup
from .models import Client, ClientSession
from .serializers import ClientDetailSerializer, ClientRowSerializer


def client_ip(request) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR", "")


def _get_client(data):
    rid = str(data.get("id") or "").strip()
    uuid = str(data.get("uuid") or "").strip()
    if not rid or not uuid:
        return None
    client, _ = Client.objects.get_or_create(rid=rid, uuid=uuid)
    return client


# ---------------------------------------------------------------------------
# ویوهای دریافت (کلاینت صدا می‌زند) — بدون احراز هویت کاربری
# ---------------------------------------------------------------------------
class SysinfoView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        client = _get_client(data)
        if client is None:
            return HttpResponse("ID_NOT_FOUND")
        now = timezone.now()
        update = []
        if client.first_seen is None:
            client.first_seen = now
            update.append("first_seen")
        client.last_seen = now
        update.append("last_seen")

        field_map = {
            "username": "name", "hostname": "hostname", "os": "os",
            "cpu": "cpu", "memory": "memory", "version": "version",
        }
        for src, dst in field_map.items():
            v = data.get(src)
            if v:
                setattr(client, dst, str(v)[:128])
                update.append(dst)

        # موقعیت فقط وقتی کاربر کلید «ارسال موقعیت» را روشن گذاشته ذخیره می‌شود.
        # اگر خاموش کرده باشد، IP/شهرِ قبلی هم پاک می‌شود.
        loc_ok = bool(data.get("loc", True))
        ip = client_ip(request)
        if loc_ok and ip and ip != client.ip:
            client.ip = ip
            city, country = lookup(ip)
            client.city, client.country = city, country
            update += ["ip", "city", "country"]
        elif not loc_ok and (client.ip or client.city or client.country):
            client.ip = client.city = client.country = ""
            update += ["ip", "city", "country"]

        client.save(update_fields=list(set(update)))
        return HttpResponse("SYSINFO_UPDATED")


class SysinfoVerView(APIView):
    """برای سرور غیرعمومی کلاینت این را صدا نمی‌زند؛ برای کامل‌بودن خالی برمی‌گرداند."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        return HttpResponse("")


class HeartbeatView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        client = _get_client(data)
        if client is None:
            return Response({})
        now = timezone.now()
        update = ["last_seen"]
        client.last_seen = now
        if client.first_seen is None:
            client.first_seen = now
            update.append("first_seen")
        conns = data.get("conns") or []
        if isinstance(conns, list) and conns:
            client.last_conns = conns
            update.append("last_conns")
        # IP/موقعیت فقط در sysinfo ذخیره می‌شود (جایی که کلید موقعیت همراه است)،
        # تا موقعیت بدون اجازهٔ کاربر ثبت نشود.

        resp = {}
        # قطع نشست‌ها: «خروج اجباری» یک‌باره، یا تا وقتی دستگاه «مسدود» است
        kick = list(conns) if isinstance(conns, list) else []
        if not kick:
            kick = list(client.last_conns or [])
        if (client.force_disconnect or client.blocked) and kick:
            resp["disconnect"] = kick
        if client.force_disconnect:
            client.force_disconnect = False
            update.append("force_disconnect")

        client.save(update_fields=list(set(update)))
        return Response(resp)


class AuditConnView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        client = _get_client(data)
        if client is None:
            return Response({"ok": True})
        now = timezone.now()
        if client.last_seen is None:
            client.first_seen = client.first_seen or now
        client.last_seen = now
        client.save(update_fields=["last_seen", "first_seen"])

        conn_id = int(data.get("conn_id") or 0)
        session_id = str(data.get("session_id") or "")
        session, _ = ClientSession.objects.get_or_create(
            client=client, conn_id=conn_id, session_id=session_id,
            defaults={"started_at": now},
        )
        changed = []
        peer = data.get("peer")
        if isinstance(peer, (list, tuple)) and len(peer) >= 2:
            session.peer_id = str(peer[0])[:32]
            session.peer_name = str(peer[1])[:128]
            changed += ["peer_id", "peer_name"]
        if data.get("type"):
            session.conn_type = str(data["type"])[:32]
            changed.append("conn_type")
        if data.get("ip"):
            session.ip = str(data["ip"])[:64]
            changed.append("ip")
        if data.get("action") == "close" and session.ended_at is None:
            session.ended_at = now
            changed.append("ended_at")
        if changed:
            session.save(update_fields=changed)
        return Response({"ok": True})


# ---------------------------------------------------------------------------
# ویوهای پنل (تیم پشتیبانی، پشت لاگین)
# ---------------------------------------------------------------------------
class ClientListView(APIView):
    def get(self, request):
        qs = Client.objects.all()
        q = (request.query_params.get("q") or "").strip()
        if q:
            from django.db.models import Q

            qs = qs.filter(
                Q(rid__icontains=q) | Q(name__icontains=q)
                | Q(hostname__icontains=q) | Q(ip__icontains=q)
            )
        return Response(ClientRowSerializer(qs[:200], many=True).data)


class ClientDetailView(APIView):
    def get(self, request, pk):
        client = Client.objects.filter(pk=pk).first()
        if client is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(ClientDetailSerializer(client).data)


class ClientDisconnectView(APIView):
    permission_classes = [ReadOnlyForViewer]

    def post(self, request, pk):
        n = Client.objects.filter(pk=pk).update(force_disconnect=True)
        if not n:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response({"ok": True})


class ClientBlockView(APIView):
    permission_classes = [ReadOnlyForViewer]

    def post(self, request, pk):
        blocked = bool(request.data.get("blocked", True))
        n = Client.objects.filter(pk=pk).update(blocked=blocked)
        if not n:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response({"ok": True, "blocked": blocked})
