"""ورود کاربران وب: کوکی جداگانه، یکسان‌سازی نام کاربری/ایمیل/موبایل و بررسی ورودی‌های ثبت‌نام.

کوکی `asw_session` فقط روی دامنهٔ وب است (HttpOnly و SameSite=Lax) و ربطی به ورود پنل ندارد. هر درخواست
تغییردهنده باید سرآیند `X-Asan-Web: 1` هم داشته باشد: مرورگر چنین سرآیندی را برای سایت دیگری بدون اجازهٔ
CORS نمی‌فرستد، پس فرمی از سایت دیگر نمی‌تواند به‌جای کاربر کاری انجام دهد (CSRF).
"""

import re
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone

from accounts.throttles import request_ip

from .models import WebSession, WebUser, sha256

COOKIE = "asw_session"
CSRF_HEADER = "HTTP_X_ASAN_WEB"
REMEMBER_AGE = timedelta(days=30)
SHORT_AGE = timedelta(hours=12)
# last_used_at را حداکثر هر یک دقیقه یک بار می‌نویسیم تا هر درخواست یک UPDATE نباشد
TOUCH_EVERY = timedelta(minutes=1)

USERNAME_RE = re.compile(r"^[a-z][a-z0-9_.]{2,31}$")
NAME_RE = re.compile(r"^[^\d\W][\w\s.'‌-]{0,63}$")
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def normalize_digits(value: str) -> str:
    return value.translate(PERSIAN_DIGITS)


def normalize_phone(value: str) -> str | None:
    """موبایل ایران به شکل 09xxxxxxxxx؛ شمارهٔ خارجی به شکل +<کد کشور><شماره>. نامعتبر → None."""
    v = re.sub(r"[\s\-()]", "", normalize_digits(value or ""))
    if v.startswith("00"):
        v = "+" + v[2:]
    if v.startswith("+98"):
        v = "0" + v[3:]
    elif re.fullmatch(r"9\d{9}", v):
        v = "0" + v
    if re.fullmatch(r"09\d{9}", v):
        return v
    if re.fullmatch(r"\+[1-9]\d{7,14}", v):
        return v
    return None


def normalize_email(value: str) -> str | None:
    v = (value or "").strip().lower()
    if len(v) > 254:
        return None
    try:
        validate_email(v)
    except ValidationError:
        return None
    return v


def normalize_username(value: str) -> str | None:
    v = (value or "").strip().lower()
    return v if USERNAME_RE.fullmatch(v) else None


def clean_name(value: str) -> str | None:
    v = " ".join(str(value or "").split())
    return v if NAME_RE.fullmatch(v) else None


def find_user(identifier: str) -> WebUser | None:
    """نام کاربری، ایمیل یا موبایل → حساب."""
    ident = (identifier or "").strip()
    if not ident or len(ident) > 254:
        return None
    if "@" in ident:
        email = normalize_email(ident)
        return WebUser.objects.filter(email=email).first() if email else None
    phone = normalize_phone(ident)
    if phone:
        return WebUser.objects.filter(phone=phone).first()
    username = normalize_username(ident)
    return WebUser.objects.filter(username=username).first() if username else None


def registration_errors(data: dict) -> tuple[dict, dict]:
    """(مقادیر تمیزشده، خطاها به‌ازای هر فیلد). خطای تکراری بودن هم همین‌جا برمی‌گردد."""
    errors: dict[str, str] = {}
    clean: dict[str, str] = {}

    for field, label in (("first_name", "نام"), ("last_name", "نام خانوادگی")):
        value = clean_name(data.get(field))
        if value is None:
            errors[field] = f"{label} را درست وارد کنید."
        else:
            clean[field] = value

    username = normalize_username(data.get("username"))
    if username is None:
        errors["username"] = "نام کاربری ۳ تا ۳۲ نویسه است، با حرف انگلیسی شروع می‌شود و فقط حرف انگلیسی، عدد، _ و . دارد."
    elif WebUser.objects.filter(username=username).exists():
        errors["username"] = "این نام کاربری قبلا گرفته شده است."
    else:
        clean["username"] = username

    email = normalize_email(data.get("email"))
    if email is None:
        errors["email"] = "ایمیل معتبر نیست."
    elif WebUser.objects.filter(email=email).exists():
        errors["email"] = "با این ایمیل قبلا حساب ساخته شده است."
    else:
        clean["email"] = email

    phone = normalize_phone(str(data.get("phone") or ""))
    if phone is None:
        errors["phone"] = "شمارهٔ موبایل معتبر نیست (مثلا 09121234567)."
    elif WebUser.objects.filter(phone=phone).exists():
        errors["phone"] = "با این شماره قبلا حساب ساخته شده است."
    else:
        clean["phone"] = phone

    password = data.get("password")
    if not isinstance(password, str) or not password:
        errors["password"] = "رمز عبور را وارد کنید."
    elif len(password) > 128:
        errors["password"] = "رمز عبور بیش از حد طولانی است."
    else:
        probe = WebUser(username=clean.get("username", ""), email=clean.get("email", ""),
                        first_name=clean.get("first_name", ""), last_name=clean.get("last_name", ""))
        try:
            validate_password(password, user=probe)
            clean["password"] = password
        except ValidationError as exc:
            errors["password"] = " ".join(exc.messages)
    return clean, errors


def password_errors(password, user: WebUser) -> str | None:
    if not isinstance(password, str) or not password:
        return "رمز عبور را وارد کنید."
    if len(password) > 128:
        return "رمز عبور بیش از حد طولانی است."
    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        return " ".join(exc.messages)
    return None


def session_from_request(request) -> WebSession | None:
    raw = request.COOKIES.get(COOKIE)
    if not raw or len(raw) > 100:
        return None
    now = timezone.now()
    session = (
        WebSession.objects.select_related("user")
        .filter(key_hash=sha256(raw), expires_at__gt=now)
        .first()
    )
    if session is None or session.user.is_blocked:
        return None
    if now - session.last_used_at > TOUCH_EVERY:
        session.last_used_at = now
        session.save(update_fields=["last_used_at"])
        WebUser.objects.filter(pk=session.user_id).update(last_seen_at=now, last_ip=request_ip(request))
    return session


def set_session_cookie(request, response, raw: str, remember: bool):
    # https را CDN تمام می‌کند و X-Forwarded-Proto می‌گوید (SECURE_PROXY_SSL_HEADER)؛ روی http محلی کوکی ساده است
    response.set_cookie(
        COOKIE, raw,
        max_age=int(REMEMBER_AGE.total_seconds()) if remember else None,
        httponly=True, samesite="Lax", secure=request.is_secure() or settings.SESSION_COOKIE_SECURE, path="/",
    )


def clear_session_cookie(response):
    response.delete_cookie(COOKIE, path="/", samesite="Lax")
