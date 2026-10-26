"""API آسان دسک وب (زیر /api/web/؛ فقط از دامنهٔ وب در nginx باز است).

این‌ها View سادهٔ Django هستند، نه DRF: احراز هویت پنل (نشست Django و SessionAuthentication) این‌جا هیچ
اثری ندارد و لاگ فعالیت پنل هم کارهای کاربران وب را ثبت نمی‌کند.
"""

import json
import logging
from functools import wraps

from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from accounts.throttles import request_ip, within_limit

from .auth import (
    CSRF_HEADER, REMEMBER_AGE, SHORT_AGE, clean_display_name, clear_session_cookie, find_user, password_errors,
    registration_errors, session_from_request, set_session_cookie,
)
from .models import Direction, WebConnection, WebDevice, WebSession, WebUser, sha256

log = logging.getLogger(__name__)

MAX_BODY = 16 * 1024
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def error(message: str, status: int = 400, **extra) -> JsonResponse:
    return JsonResponse({"error": message, **extra}, status=status)


def web_view(methods: tuple[str, ...], auth: bool = True):
    """روش‌های مجاز، سرآیند ضد CSRF برای درخواست‌های تغییردهنده، خواندن JSON و (در صورت نیاز) ورود."""

    def deco(fn):
        @csrf_exempt
        @wraps(fn)
        def view(request, *args, **kwargs):
            if request.method not in methods:
                return error("روش درخواست مجاز نیست.", 405)
            if request.method in UNSAFE and request.META.get(CSRF_HEADER) != "1":
                return error("درخواست نامعتبر است.", 403, code="csrf")
            data = {}
            if request.method in UNSAFE and request.body:
                if len(request.body) > MAX_BODY:
                    return error("بدنهٔ درخواست بیش از حد بزرگ است.", 413)
                try:
                    data = json.loads(request.body)
                except (ValueError, UnicodeDecodeError):
                    return error("بدنهٔ درخواست JSON معتبر نیست.")
                if not isinstance(data, dict):
                    return error("بدنهٔ درخواست JSON معتبر نیست.")
            session = session_from_request(request)
            if auth and session is None:
                return error("ابتدا وارد حساب خود شوید.", 401, code="unauthorized")
            return fn(request, data, session, *args, **kwargs)

        return view

    return deco


def me_payload(user: WebUser) -> dict:
    return {
        "display_name": user.display_name,
        "name": user.name,
        "email": user.email or "",
        "phone": user.phone or "",
        "web_id": user.web_id,
        "created_at": user.created_at.isoformat(),
    }


def start_session(request, user: WebUser, remember: bool) -> JsonResponse:
    now = timezone.now()
    ip = request_ip(request)
    _, raw = WebSession.issue(
        user, REMEMBER_AGE if remember else SHORT_AGE, ip, request.META.get("HTTP_USER_AGENT", ""),
    )
    WebUser.objects.filter(pk=user.pk).update(last_login_at=now, last_seen_at=now, last_ip=ip)
    WebSession.objects.filter(user=user, expires_at__lte=now).delete()
    response = JsonResponse({"user": me_payload(user)})
    set_session_cookie(request, response, raw, remember)
    return response


# ---------- حساب ----------

@web_view(("GET",), auth=False)
def config(request, data, session):
    """تنظیمات عمومی برنامهٔ وب؛ از .env سرور می‌آید تا برای عوض کردن آدرس‌ها بیلد دوباره لازم نباشد."""
    return JsonResponse({
        "key": settings.WEB_RS_PUBLIC_KEY,
        "id_ws": settings.WEB_ID_WS,
        "relay_ws": settings.WEB_RELAY_WS,
        "relay_ws_map": settings.WEB_RELAY_WS_MAP,
        "relay_domain": settings.WEB_RELAY_DOMAIN,
        "gw_ws": settings.WEB_GW_WS,
        "rendezvous_host": settings.WEB_RENDEZVOUS_HOST,
        "download_url": settings.WEB_DOWNLOAD_URL,
    })


@web_view(("POST",), auth=False)
def register(request, data, session):
    if not within_limit("websignup", request, settings.WEB_SIGNUPS_PER_IP_HOUR, 3600):
        return error("ثبت‌نام‌های زیادی از این شبکه انجام شده است. کمی بعد دوباره امتحان کنید.", 429)
    clean, errors = registration_errors(data)
    if errors:
        return error("لطفا خطاهای فرم را برطرف کنید.", fields=errors)
    user = WebUser(
        display_name=clean["display_name"], email=clean.get("email"), phone=clean.get("phone"),
        signup_ip=request_ip(request),
    )
    user.set_password(clean["password"])
    try:
        with transaction.atomic():
            user.ensure_identity()
            user.save()
    except IntegrityError:
        # دو ثبت‌نام هم‌زمان با یک مقدار؛ بررسی بالا قبل از ذخیره بود
        return error("این ایمیل یا شماره قبلا ثبت شده است.", fields={"identifier": "این ایمیل یا شماره قبلا ثبت شده است."})
    log.info("web user %s registered", user.web_id)
    return start_session(request, user, remember=True)


@web_view(("POST",), auth=False)
def login(request, data, session):
    if not within_limit("weblogin", request, settings.WEB_LOGINS_PER_IP_MINUTE, 60):
        return error("تلاش بیش از حد؛ یک دقیقه بعد دوباره امتحان کنید.", 429)
    identifier = data.get("identifier")
    password = data.get("password")
    if not isinstance(identifier, str) or not isinstance(password, str) or not identifier or not password:
        return error("ایمیل یا شمارهٔ موبایل و رمز عبور را وارد کنید.")
    user = find_user(identifier)
    if user is None:
        # هش کردن بی‌فایده تا زمان پاسخ «چنین کاربری نیست» با «رمز اشتباه» یکی باشد (مثل ModelBackend)
        WebUser().set_password(password)
        return error("ایمیل/موبایل یا رمز عبور اشتباه است.")
    if not user.check_password(password):
        return error("ایمیل/موبایل یا رمز عبور اشتباه است.")
    if user.is_blocked:
        return error("این حساب مسدود شده است. با پشتیبانی آسان دسک تماس بگیرید.", 403, code="blocked")
    return start_session(request, user, remember=bool(data.get("remember", True)))


@web_view(("POST",), auth=False)
def logout(request, data, session):
    if session is not None:
        session.delete()
    response = JsonResponse({})
    clear_session_cookie(response)
    return response


@web_view(("GET", "PATCH"))
def me(request, data, session):
    user = session.user
    if request.method == "PATCH":
        # فقط نام نمایشی را خود کاربر عوض می‌کند (اختیاری است و بعد از ثبت‌نام هم می‌شود گذاشتش)
        name = clean_display_name(data.get("display_name"))
        if name is None:
            problem = "نام نمایشی حداکثر ۶۴ نویسه است و < > نمی‌پذیرد."
            return error(problem, fields={"display_name": problem})
        user.display_name = name
        user.save(update_fields=["display_name"])
    return JsonResponse({"user": me_payload(user)})


@web_view(("POST",))
def change_password(request, data, session):
    if not within_limit("webpass", request, settings.WEB_LOGINS_PER_IP_MINUTE, 60):
        return error("تلاش بیش از حد؛ یک دقیقه بعد دوباره امتحان کنید.", 429)
    user = session.user
    current = data.get("current")
    if not isinstance(current, str) or not user.check_password(current):
        return error("رمز فعلی اشتباه است.", fields={"current": "رمز فعلی اشتباه است."})
    new = data.get("new")
    problem = password_errors(new, user)
    if problem:
        return error(problem, fields={"new": problem})
    user.set_password(new)
    user.save(update_fields=["password"])
    # ورود در مرورگرهای دیگر بسته می‌شود؛ همین مرورگر وارد می‌ماند
    WebSession.objects.filter(user=user).exclude(pk=session.pk).delete()
    return JsonResponse({})


@web_view(("GET",))
def peer(request, data, session):
    """شناسهٔ همتای این حساب برای ثبت در سرور شناسه؛ درگاه وب با کوکی همین کاربر این را می‌پرسد."""
    user = session.user
    return JsonResponse({
        "web_id": user.web_id, "uuid": user.peer_uuid, "pk": user.sign_pk, "name": user.display_name,
    })


@web_view(("GET",))
def peer_key(request, data, session):
    """کلید خصوصی هویت این حساب، فقط برای مرورگر خود کاربر (امضای SignedId در اشتراک صفحه)."""
    if request.META.get(CSRF_HEADER) != "1":
        return error("درخواست نامعتبر است.", 403, code="csrf")
    user = session.user
    # uuid همان «شناسهٔ ماشین» این حساب در API کلاینت‌هاست (heartbeat، بازخورد)، مثل برنامهٔ دسکتاپ
    response = JsonResponse({"web_id": user.web_id, "seed": user.sign_seed, "pk": user.sign_pk, "uuid": user.peer_uuid})
    response["Cache-Control"] = "no-store"
    return response


# ---------- دستگاه‌ها ----------

def device_payload(d: WebDevice) -> dict:
    return {
        "peer_id": d.peer_id, "name": d.name, "platform": d.platform, "favorite": d.favorite,
        "last_connected_at": d.last_connected_at.isoformat(),
    }


def clean_peer_id(value) -> str | None:
    v = "".join(str(value or "").split())
    return v if 6 <= len(v) <= 32 and v.replace("-", "").replace("_", "").isalnum() else None


@web_view(("GET", "POST"))
def devices(request, data, session):
    user = session.user
    if request.method == "GET":
        return JsonResponse({"devices": [device_payload(d) for d in user.devices.all()[:200]]})
    peer_id = clean_peer_id(data.get("peer_id"))
    if peer_id is None:
        return error("کد دستگاه معتبر نیست.")
    name = str(data.get("name") or "")[:128]
    platform = str(data.get("platform") or "")[:32]
    device, created = WebDevice.objects.get_or_create(
        user=user, peer_id=peer_id, defaults={"name": name, "platform": platform},
    )
    if not created:
        device.last_connected_at = timezone.now()
        fields = ["last_connected_at"]
        if name:
            device.name = name
            fields.append("name")
        if platform:
            device.platform = platform
            fields.append("platform")
        device.save(update_fields=fields)
    return JsonResponse({"device": device_payload(device)})


@web_view(("PATCH", "DELETE"))
def device_detail(request, data, session, peer_id):
    device = WebDevice.objects.filter(user=session.user, peer_id=peer_id).first()
    if device is None:
        return error("این دستگاه در فهرست شما نیست.", 404)
    if request.method == "DELETE":
        device.delete()
        return JsonResponse({})
    if "favorite" in data:
        device.favorite = bool(data["favorite"])
    if "name" in data:
        device.name = str(data["name"] or "")[:128]
    device.save(update_fields=["favorite", "name"])
    return JsonResponse({"device": device_payload(device)})


# ---------- گزارش اتصال‌ها ----------

@web_view(("POST",))
def connections(request, data, session):
    direction = data.get("direction")
    if direction not in Direction.values:
        return error("جهت اتصال نامعتبر است.")
    # یک کاربر واقعی در دقیقه چند اتصال بیشتر نمی‌زند؛ سقف جلوی پر کردن جدول را می‌گیرد
    if not within_limit(f"webconn:{session.user_id}", request, 30, 60):
        return error("تلاش بیش از حد.", 429)
    conn = WebConnection.objects.create(
        user=session.user, direction=direction, peer_id=str(data.get("peer_id") or "")[:32],
        peer_name=str(data.get("peer_name") or "")[:128], ip=request_ip(request),
    )
    return JsonResponse({"id": conn.pk})


@web_view(("POST",))
def connection_end(request, data, session, pk):
    WebConnection.objects.filter(pk=pk, user=session.user, ended_at__isnull=True).update(ended_at=timezone.now())
    return JsonResponse({})
