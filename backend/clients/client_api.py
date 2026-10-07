"""API که خود اپلیکیشن آسان‌دسک صدا می‌زند (سازگار با API سرور RustDesk).

کلاینت وقتی `api-server` تنظیم شده باشد این مسیرها را صدا می‌زند:
  /api/heartbeat، /api/sysinfo، /api/sysinfo_ver، /api/audit/conn،
  /api/login، /api/currentUser، /api/logout، /api/login-options
به‌علاوه مسیرهای تیکت آسان‌دسک زیر /api/client/tickets.

بدنه درخواست‌ها JSON است ولی کلاینت همیشه Content-Type نمی‌فرستد، پس بدنه دستی خوانده می‌شود.
احراز هویت دستگاه: جفت (id, uuid). uuid در اولین تماس ثبت می‌شود (TOFU).
"""

import base64
import json
import logging
import zlib
from datetime import timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from rest_framework.throttling import SimpleRateThrottle

from .models import (
    AccessToken, Account, Client, ConnSession, FeedbackCategory, Priority, Ticket, TicketMessage, TicketStatus, sha256,
)

log = logging.getLogger(__name__)

MAX_BODY = 64 * 1024


def read_json(request) -> dict:
    if len(request.body) > MAX_BODY:
        return {}
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def s(data: dict, key: str, limit: int) -> str:
    v = data.get(key)
    return str(v).strip()[:limit] if v is not None else ""


def client_ip(request) -> str:
    # nginx آدرس واقعی را در X-Real-IP می‌گذارد
    return (request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR") or "")[:64]


def device(data: dict, request, create: bool) -> tuple[Client | None, bool]:
    """کلاینت متناظر با (id, uuid). خروجی: (کلاینت، تازه ساخته شد؟). uuid نادرست → None."""
    rd_id = s(data, "id", 32)
    uuid = s(data, "uuid", 200)
    if not rd_id or not uuid:
        return None, False
    client = Client.objects.select_related("account").filter(rd_id=rd_id).first()
    if client is None:
        if not create:
            return None, False
        try:
            with transaction.atomic():
                client = Client.objects.create(
                    rd_id=rd_id, uuid_hash=sha256(uuid), last_seen=timezone.now()
                )
            return client, True
        except IntegrityError:  # درخواست همزمان همین دستگاه
            client = Client.objects.select_related("account").get(rd_id=rd_id)
    if not client.uuid_hash:
        # مالک «بازنشانی کلید دستگاه» را زده؛ اولین تماس بعدی uuid جدید را ثبت می‌کند
        client.uuid_hash = sha256(uuid)
        client.save(update_fields=["uuid_hash"])
    elif not client.check_uuid(uuid):
        log.warning("client %s: uuid mismatch from %s", rd_id, client_ip(request))
        return None, False
    return client, False


def touch(client: Client, request, now=None):
    """به‌روزرسانی آخرین تماس؛ برای کم کردن نوشتن، حداکثر هر ۱۰ ثانیه."""
    now = now or timezone.now()
    fields = []
    if not client.last_seen or (now - client.last_seen).total_seconds() >= 10:
        client.last_seen = now
        fields.append("last_seen")
    # IP فقط با اجازهٔ کاربر (کلید موقعیت در کلاینت؛ SysinfoView)
    ip = client_ip(request) if client.share_location else ""
    if ip and ip != client.ip:
        client.ip = ip
        fields.append("ip")
    if fields:
        client.save(update_fields=fields)


def text(body: str, status=200):
    return HttpResponse(body, status=status, content_type="text/plain; charset=utf-8")


@method_decorator(csrf_exempt, name="dispatch")
class ClientView(View):
    http_method_names = ["post"]


class HeartbeatView(ClientView):
    """هر ۱۵ ثانیه (و هنگام اتصال فعال هر ۳ ثانیه). conns = شناسه اتصال‌های ورودی باز."""

    def post(self, request):
        data = read_json(request)
        client, created = device(data, request, create=True)
        if client is None:
            return JsonResponse({"error": "invalid id/uuid"}, status=401)
        now = timezone.now()
        touch(client, request, now)
        conns = [c for c in data.get("conns") or [] if isinstance(c, int)][:256]
        # اتصال‌هایی که دیگر در فهرست نیستند بسته شده‌اند (گزارش close ممکن است گم شده باشد)
        ConnSession.objects.filter(
            client=client, ended_at__isnull=True, started_at__lt=now - timedelta(seconds=30)
        ).exclude(conn_id__in=conns).update(ended_at=now)

        modified_at = data.get("modified_at")
        rsp = {"modified_at": modified_at if isinstance(modified_at, int) else 0}
        if created or client.sysinfo_at is None:
            rsp["sysinfo"] = True
        if client.blocked and conns:
            rsp["disconnect"] = conns
        return JsonResponse(rsp)


class SysinfoView(ClientView):
    def post(self, request):
        data = read_json(request)
        client, _ = device(data, request, create=True)
        if client is None:
            return text("ID_NOT_FOUND")
        client.hostname = s(data, "hostname", 128)
        client.os_user = s(data, "username", 128)
        client.os = s(data, "os", 200)
        client.cpu = s(data, "cpu", 200)
        client.memory = s(data, "memory", 32)
        client.version = s(data, "version", 32)
        client.sysinfo_at = timezone.now()
        # کلاینت‌هایی که پرچم loc نمی‌فرستند (قدیمی) موقعیت را خاموش نکرده‌اند
        client.share_location = bool(data.get("loc", True))
        fields = ["hostname", "os_user", "os", "cpu", "memory", "version", "sysinfo_at", "share_location"]
        if not client.share_location and client.ip:
            client.ip = ""
            fields.append("ip")
        client.save(update_fields=fields)
        touch(client, request)
        return text("SYSINFO_UPDATED")


class SysinfoVerView(ClientView):
    # نسخه قالب sysinfo سمت سرور؛ تا وقتی تغییر نکند کلاینت sysinfo تکراری نمی‌فرستد
    def post(self, request):
        return text("1")


class AuditConnView(ClientView):
    """گزارش کلاینت کنترل‌شونده: action=new (اتصال TCP)، بدون action با peer (احراز هویت موفق)، action=close."""

    def post(self, request):
        data = read_json(request)
        client, _ = device(data, request, create=False)
        if client is None:
            return text("")
        conn_id = data.get("conn_id")
        if not isinstance(conn_id, int):
            return text("")
        now = timezone.now()
        open_qs = ConnSession.objects.filter(client=client, conn_id=conn_id, ended_at__isnull=True)
        action = data.get("action")
        if action == "new":
            open_qs.update(ended_at=now)
            ConnSession.objects.create(
                client=client, conn_id=conn_id, session_id=s(data, "session_id", 24), ip=s(data, "ip", 64), started_at=now
            )
        elif action == "close":
            open_qs.update(ended_at=now)
        elif "peer" in data:
            peer = data.get("peer")
            peer_id, peer_name = "", ""
            if isinstance(peer, list) and peer:
                peer_id = str(peer[0])[:32]
                peer_name = str(peer[1])[:128] if len(peer) > 1 else ""
            conn_type = data.get("type") if isinstance(data.get("type"), int) else None
            fields = {"peer_id": peer_id, "peer_name": peer_name, "conn_type": conn_type, "authorized_at": now}
            if not open_qs.update(**fields):
                ConnSession.objects.create(client=client, conn_id=conn_id, session_id=s(data, "session_id", 24),
                                           started_at=now, **fields)
        return text("")


class AuditIgnoreView(ClientView):
    """audit/file و audit/alarm فعلاً ذخیره نمی‌شوند."""

    def post(self, request, kind=None):
        return text("")


class LoginThrottle(SimpleRateThrottle):
    scope = "client_login"
    rate = "10/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": client_ip(request) or "anon"}


def user_payload(account: Account) -> dict:
    return {
        "name": account.email,
        "display_name": account.display_name,
        "email": account.email,
        "note": "",
        "status": 1,
        "is_admin": False,
        "plan": account.plan,
    }


def bearer_account(request) -> tuple[Account | None, AccessToken | None]:
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    if not token:
        return None, None
    at = AccessToken.objects.select_related("account").filter(token_hash=sha256(token)).first()
    if at is None or not at.account.is_active:
        return None, None
    return at.account, at


class LoginView(ClientView):
    def post(self, request):
        throttle = LoginThrottle()
        if not throttle.allow_request(request, self):
            return JsonResponse({"error": "تلاش بیش از حد؛ کمی بعد دوباره امتحان کنید."}, status=429)
        data = read_json(request)
        email = s(data, "username", 254).lower()
        password = data.get("password") or ""
        account = Account.objects.filter(email__iexact=email).first()
        if account is None or not isinstance(password, str) or not account.check_password(password) or not account.is_active:
            return JsonResponse({"error": "ایمیل یا رمز عبور اشتباه است."})
        client, _ = device(data, request, create=True)
        if client is not None and client.blocked:
            return JsonResponse({"error": "این دستگاه مسدود شده است."})
        token = AccessToken.issue(account, client)
        now = timezone.now()
        account.last_login = now
        account.save(update_fields=["last_login"])
        if client is not None:
            client.account = account
            client.save(update_fields=["account"])
            touch(client, request, now)
        return JsonResponse({"access_token": token, "type": "access_token", "user": user_payload(account)})


class CurrentUserView(ClientView):
    def post(self, request):
        account, at = bearer_account(request)
        if account is None:
            return JsonResponse({"error": "unauthorized"}, status=401)
        return JsonResponse(user_payload(account))


class LogoutView(ClientView):
    def post(self, request):
        _, at = bearer_account(request)
        if at is not None:
            if at.client_id:
                Client.objects.filter(pk=at.client_id, account_id=at.account_id).update(account=None)
            at.delete()
        return JsonResponse({})


def login_options(request):
    # فقط ورود با ایمیل و رمز؛ OIDC نداریم
    return JsonResponse([], safe=False)


# ---------- تیکت‌ها از داخل اپلیکیشن ----------

def ticket_json(t: Ticket) -> dict:
    return {
        "id": t.pk,
        "code": t.code,
        "subject": t.subject,
        "category": t.category,
        "status": t.status,
        "created_at": t.created_at.isoformat(),
        "messages": [
            {"from_client": m.from_client, "text": m.text, "created_at": m.created_at.isoformat()}
            for m in t.messages.all()
        ],
    }


def auth_device(request):
    data = read_json(request)
    client, _ = device(data, request, create=False)
    if client is not None:
        touch(client, request)
    return data, client


class ClientTicketListView(ClientView):
    def post(self, request):
        _, client = auth_device(request)
        if client is None:
            return JsonResponse({"error": "invalid id/uuid"}, status=401)
        qs = client.tickets.prefetch_related("messages")[:50]
        return JsonResponse({"tickets": [ticket_json(t) for t in qs]})


class ClientTicketCreateView(ClientView):
    def post(self, request):
        data, client = auth_device(request)
        if client is None:
            return JsonResponse({"error": "invalid id/uuid"}, status=401)
        if client.blocked:
            return JsonResponse({"error": "این دستگاه مسدود شده است."}, status=403)
        subject = s(data, "subject", 200)
        body = s(data, "text", 5000)
        if not subject or not body:
            return JsonResponse({"error": "موضوع و متن را وارد کنید."}, status=400)
        if client.tickets.filter(created_at__gte=timezone.now() - timedelta(hours=1)).count() >= settings.CLIENT_TICKETS_PER_HOUR:
            return JsonResponse({"error": "تعداد تیکت‌ها بیش از حد مجاز است."}, status=429)
        priority = s(data, "priority", 8)
        diag = s(data, "diag", 300) or " · ".join(x for x in (f"v{client.version}" if client.version else "", client.os) if x)
        with transaction.atomic():
            t = Ticket.objects.create(
                client=client,
                subject=subject,
                category=s(data, "category", 64),
                priority=priority if priority in Priority.values else Priority.NORMAL,
                diag=diag,
            )
            TicketMessage.objects.create(ticket=t, from_client=True, text=body)
        return JsonResponse(ticket_json(t), status=201)


FEEDBACK_PRIORITY = {
    FeedbackCategory.BUG: Priority.NORMAL,
    FeedbackCategory.IDEA: Priority.LOW,
    FeedbackCategory.OTHER: Priority.NORMAL,
}


def feedback_subject(message: str) -> str:
    """موضوع = اولین خط غیرخالی متن کاربر (حداکثر ۸۰ نویسه)."""
    for line in message.splitlines():
        line = " ".join(line.split())
        if line:
            return line[:80]
    return "بازخورد"


def feedback_diag(data: dict) -> str:
    """خلاصهٔ فنی برای ستون «اطلاعات پیوست»: نسخه · سیستم‌عامل · صفحه · زبان/تم."""
    os_text = " ".join(x for x in (s(data, "os", 32), s(data, "os_version", 120)) if x)
    parts = [
        f"v{s(data, 'version', 32)}" if s(data, "version", 32) else "",
        os_text,
        s(data, "screen", 40),
        "/".join(x for x in (s(data, "lang", 8), s(data, "theme", 8)) if x),
    ]
    return " · ".join(p for p in parts if p)[:300]


def decode_feedback_log(data: dict) -> bytes | None:
    """لاگ پیوستی (gzip+base64) را باز می‌کند. بدون لاگ None؛ نامعتبر/بزرگ ValueError."""
    blob = data.get("log")
    if not data.get("log_attached", True) or not blob or not isinstance(blob, str):
        return None
    limit = settings.FEEDBACK_MAX_LOG_BYTES
    try:
        gz = base64.b64decode(blob, validate=True)
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = d.decompress(gz, limit + 1)
    except (ValueError, zlib.error):
        raise ValueError("invalid")
    if len(raw) > limit:
        raise ValueError("too-big")
    return raw


class ClientFeedbackView(ClientView):
    """«ارسال بازخورد» از داخل اپلیکیشن: متن کاربر + لاگ برنامه از لحظهٔ باز شدن.

    بدنهٔ JSON (جزئیات: docs/ASANDESK-FEEDBACK-API.md در ریپوی اپلیکیشن):
      id، uuid، category (bug|idea|other)، message، contact، version، os، os_version،
      screen، lang، theme، log_attached، log (gzip+base64)، log_files.
    بازخورد به‌صورت یک «تیکت» ثبت می‌شود و لاگ بازشده کنارش نگه‌داری می‌شود.
    """

    def post(self, request):
        if len(request.body) > settings.FEEDBACK_MAX_BODY:
            return JsonResponse({"error": "حجم درخواست زیاد است."}, status=413)
        try:
            data = json.loads(request.body or b"{}")
        except (ValueError, UnicodeDecodeError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        # نسخه‌های اول اپ شناسه را device_id می‌فرستادند
        if not data.get("id") and data.get("device_id"):
            data["id"] = data["device_id"]
        # دستگاهی که تا حالا heartbeat نفرستاده (مثلاً گزارش پشتیبانی را خاموش کرده) همین‌جا ثبت می‌شود
        client, _ = device(data, request, create=True)
        if client is None:
            return JsonResponse({"error": "invalid id/uuid"}, status=401)
        touch(client, request)
        if client.blocked:
            return JsonResponse({"error": "این دستگاه مسدود شده است."}, status=403)

        message = s(data, "message", 4000)
        if len(message) < 5:
            return JsonResponse({"error": "متن بازخورد را بنویسید."}, status=400)
        recent = client.tickets.filter(created_at__gte=timezone.now() - timedelta(hours=1)).count()
        if recent >= settings.CLIENT_FEEDBACK_PER_HOUR:
            return JsonResponse({"error": "تعداد بازخوردها بیش از حد مجاز است."}, status=429)
        try:
            raw = decode_feedback_log(data)
        except ValueError as e:
            too_big = str(e) == "too-big"
            return JsonResponse(
                {"error": "حجم لاگ زیاد است." if too_big else "لاگ پیوست‌شده معتبر نیست."},
                status=413 if too_big else 400,
            )

        category = s(data, "category", 16)
        if category not in FeedbackCategory.values:
            category = FeedbackCategory.OTHER
        files = data.get("log_files")
        files = [str(x)[:120] for x in files[:30]] if isinstance(files, list) else []
        with transaction.atomic():
            t = Ticket.objects.create(
                client=client,
                subject=feedback_subject(message),
                category=category,
                priority=FEEDBACK_PRIORITY[FeedbackCategory(category)],
                diag=feedback_diag(data),
                contact=s(data, "contact", 120),
            )
            TicketMessage.objects.create(ticket=t, from_client=True, text=message)
            if raw is not None:
                t.log_file.save(f"{t.code}.log", ContentFile(raw), save=False)
                t.log_size = len(raw)
                t.log_files = files
                t.save(update_fields=["log_file", "log_size", "log_files"])
        return JsonResponse({"ok": True, "id": t.code, "code": t.code}, status=201)


class ClientTicketReplyView(ClientView):
    def post(self, request, pk):
        data, client = auth_device(request)
        if client is None:
            return JsonResponse({"error": "invalid id/uuid"}, status=401)
        t = client.tickets.filter(pk=pk).first()
        if t is None:
            return JsonResponse({"error": "not found"}, status=404)
        body = s(data, "text", 5000)
        if not body:
            return JsonResponse({"error": "متن را وارد کنید."}, status=400)
        with transaction.atomic():
            TicketMessage.objects.create(ticket=t, from_client=True, text=body)
            # پاسخ کاربر تیکت را دوباره به صف «باز» برمی‌گرداند
            t.set_status(TicketStatus.OPEN)
            t.save(update_fields=["status", "closed_at", "updated_at"])
        return JsonResponse(ticket_json(t))
