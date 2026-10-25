"""تنظیمات Django داشبورد آسان‌دسک — همه مقادیر حساس از متغیرهای محیطی خوانده می‌شوند."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name, default=None):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    return env(name, str(default)).lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [x.strip() for x in env(name, default).split(",") if x.strip()]


# رازهای تولیدشده خودکار (کلید Django، کد راه‌اندازی) — در داکر روی volume اختصاصی backend
SECRETS_DIR = Path(env("SECRETS_DIR", BASE_DIR / "data" / "secrets"))


def read_secret(path: Path):
    try:
        return path.read_text().strip() or None
    except OSError:
        return None


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = env("DJANGO_SECRET_KEY") or read_secret(SECRETS_DIR / "django_secret_key")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("Django secret key not found (entrypoint.sh generates it in SECRETS_DIR)")
    SECRET_KEY = "dev-insecure-key"

# پنل پشت nginx است؛ Host هر دامنه/IP که به سرور اشاره کند پذیرفته می‌شود
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "*")
# درخواست‌های هم‌مبدأ نیازی به این فهرست ندارند؛ فقط برای مبدأهای دیگر
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "accounts",
    "monitoring",
    "releases",
    "clients",
    "backups",
    "ha",
    "activity",
    "ops",
    "notices",
    "webusers",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "activity.middleware.ActivityMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "asandesk"),
        "USER": env("POSTGRES_USER", "asandesk"),
        "PASSWORD": env("POSTGRES_PASSWORD", "asandesk"),
        "HOST": env("POSTGRES_HOST", "localhost"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fa-ir"
TIME_ZONE = env("TZ", "Asia/Tehran")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = Path(env("STATIC_ROOT", BASE_DIR / "staticfiles"))

# فایل‌های نصب و latest.json — در داکر یک volume مشترک با nginx است
RELEASES_ROOT = Path(env("RELEASES_ROOT", BASE_DIR / "data" / "releases"))
MEDIA_ROOT = RELEASES_ROOT
MEDIA_URL = "/releases/"
FILE_UPLOAD_TEMP_DIR = env("FILE_UPLOAD_TEMP_DIR") or None
RELEASE_MAX_FILE_SIZE = int(env("RELEASE_MAX_FILE_MB", "500")) * 1024 * 1024
# آدرس عمومی لینک‌های دانلود در latest.json. خالی = از آدرسی که پنل با آن باز شده گرفته می‌شود
PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "").rstrip("/")
# دانلود فایل نصب از لینکی که مالک می‌دهد (releases/links.py). دامنه همان است که اپلیکیشن می‌پذیرد
RELEASE_LINK_DOMAIN = env("RELEASE_LINK_DOMAIN", "asandesk.ir")
RELEASE_LINK_ALLOW_PRIVATE = env_bool("RELEASE_LINK_ALLOW_PRIVATE", False)
RELEASE_LINK_CONNECT_TIMEOUT = 30
RELEASE_LINK_TOTAL_TIMEOUT = int(env("RELEASE_LINK_TOTAL_TIMEOUT", "540"))
# پشت nginx: ارسال فایل با X-Accel-Redirect به‌جای خواندن در Django
USE_X_ACCEL_REDIRECT = env_bool("USE_X_ACCEL_REDIRECT", False)
X_ACCEL_PREFIX = "/_protected/releases/"

# پشتیبان‌گیری: فایل‌های .adbk اینجا نگه‌داری می‌شوند (volume مشترک backend و scheduler)
BACKUPS_ROOT = Path(env("BACKUPS_ROOT", BASE_DIR / "data" / "backups"))
BACKUP_MAX_UPLOAD = 4 * 1024 ** 3

# آدرس مخفی پنل (فقط nginx آن را اجرا می‌کند؛ این‌جا برای ساختن فایل «اطلاعات ورود» کاربر تازه است)
PANEL_KEY = env("PANEL_KEY", "")

# سرویس control (به‌روزرسانی پنل و لاگ داکر): فقط backend با این توکن با آن حرف می‌زند
CONTROL_URL = env("CONTROL_URL", "http://control:8100")
CONTROL_TOKEN_FILE = Path(env("CONTROL_TOKEN_FILE", BASE_DIR / "data" / "control" / "token"))

# لاگ فعالیت: ردیف‌های قدیمی‌تر از این تعداد روز پاک می‌شوند (۰ = هرگز)
ACTIVITY_KEEP_DAYS = int(env("ACTIVITY_KEEP_DAYS", "180"))

# مانیتورینگ
METRICS_RETENTION_DAYS = int(env("METRICS_RETENTION_DAYS", "90"))
SERVER_OFFLINE_AFTER_SECONDS = int(env("SERVER_OFFLINE_AFTER_SECONDS", "120"))

# کلاینت‌ها: heartbeat هر ۱۵ ثانیه است؛ بعد از این مدت بدون تماس «آفلاین» حساب می‌شوند
CLIENT_OFFLINE_AFTER_SECONDS = int(env("CLIENT_OFFLINE_AFTER_SECONDS", "60"))
# «ارسال بازخورد» اپلیکیشن: متن + لاگ فشرده (gzip+base64) در یک درخواست JSON
CLIENT_FEEDBACK_PER_HOUR = int(env("CLIENT_FEEDBACK_PER_HOUR", "5"))
# سقف به‌ازای هر آدرس IP (دستگاه را مهاجم می‌سازد، پس سقف هر دستگاه کافی نیست): دستگاه تازه و بازخورد در ساعت
CLIENT_NEW_DEVICES_PER_IP_HOUR = int(env("CLIENT_NEW_DEVICES_PER_IP_HOUR", "100"))
CLIENT_FEEDBACK_PER_IP_HOUR = int(env("CLIENT_FEEDBACK_PER_IP_HOUR", "30"))
# دلیل اتصال‌های ناموفق که اپ گزارش می‌دهد: سقف هر دستگاه در ساعت و چند روز نگه‌داری (۰ = همیشه)
CLIENT_CONN_FAILURES_PER_HOUR = int(env("CLIENT_CONN_FAILURES_PER_HOUR", "120"))
CONN_FAILURE_KEEP_DAYS = int(env("CONN_FAILURE_KEEP_DAYS", "90"))
# سقف کل فضای لاگ و تصویر بازخوردها؛ بعد از آن فقط متن بازخورد ذخیره می‌شود
FEEDBACK_MAX_TOTAL_BYTES = int(env("FEEDBACK_MAX_TOTAL_MB", "2048")) * 1024 * 1024
# بدنه: متن + لاگ (تا ~۲ مگابایت base64) + حداکثر ۳ تصویر (اپ هرکدام را زیر ~۰٫۶ مگابایت نگه می‌دارد)
FEEDBACK_MAX_BODY = 8 * 1024 * 1024
# سقف حجم لاگِ بازشده؛ جلوی فایل فشردهٔ مخرب (zip bomb) را می‌گیرد
FEEDBACK_MAX_LOG_BYTES = int(env("FEEDBACK_MAX_LOG_MB", "10")) * 1024 * 1024
# تصویرهای پیوست بازخورد: تعداد و سقف حجم هر تصویر (بعد از base64)
FEEDBACK_MAX_IMAGES = 3
FEEDBACK_MAX_IMAGE_BYTES = int(env("FEEDBACK_MAX_IMAGE_MB", "2")) * 1024 * 1024
# Django بدنهٔ بزرگ‌تر از این را قبل از خواندن request.body رد می‌کند (پیش‌فرض ۲٫۵ مگابایت)
DATA_UPLOAD_MAX_MEMORY_SIZE = FEEDBACK_MAX_BODY + 1024 * 1024

# آسان دسک وب (web.asandesk.ir؛ backend/webusers). برنامهٔ وب این مقادیر را از /api/web/config می‌خواند.
# کلید عمومی سرور شناسه (همان ORG_PUBLIC_KEY برنامهٔ دسکتاپ؛ id_ed25519.pub روی سرور hbbs)
WEB_RS_PUBLIC_KEY = env("WEB_RS_PUBLIC_KEY", "joRoqzc0SDOHe61V9WrRORk4PqBVzBntfGtzveM3h8M=")
# نشانی وب‌سوکت سرور شناسه و رله از دید مرورگر (nginx همین مسیرها را به 21118 و 21119 می‌رساند)
WEB_ID_WS = env("WEB_ID_WS", "/ws/id")
WEB_RELAY_WS = env("WEB_RELAY_WS", "/ws/relay")
# اگر چند رله دارید: «نام رله=نشانی وب‌سوکت» با کاما، مثلا relay2.asandesk.ir=wss://relay2.asandesk.ir/ws/relay
WEB_RELAY_WS_MAP = dict(x.split("=", 1) for x in env_list("WEB_RELAY_WS_MAP", "") if "=" in x)
# رله‌هایی که زیر این دامنه‌اند از مسیر /ws/relay/<نام رله> در nginx می‌گذرند (hbbs چند رله را می‌چرخاند)
WEB_RELAY_DOMAIN = env("WEB_RELAY_DOMAIN", "asandesk.ir")
# درگاه وب (webgw): کد کاربر وب را در سرور شناسه ثبت می‌کند تا دیگران بتوانند صفحه‌اش را ببینند
WEB_GW_WS = env("WEB_GW_WS", "/ws/gw")
WEB_RENDEZVOUS_HOST = env("WEB_RENDEZVOUS_HOST", "rd.asandesk.ir")
WEB_DOWNLOAD_URL = env("WEB_DOWNLOAD_URL", "https://asandesk.ir/download")
# سرویس web داخل docker compose؛ پنل نسخهٔ در حال اجرای کلاینت وب را از /version.json آن می‌خواند
WEB_APP_URL = env("WEB_APP_URL", "http://web")
WEB_SIGNUPS_PER_IP_HOUR = int(env("WEB_SIGNUPS_PER_IP_HOUR", "10"))
WEB_LOGINS_PER_IP_MINUTE = int(env("WEB_LOGINS_PER_IP_MINUTE", "10"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7
# "Remember me" at login: the session lasts this long. Without it the session ends when the browser closes.
SESSION_REMEMBER_AGE = 60 * 60 * 24 * 30
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env_bool("SECURE_COOKIES", False)
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
USE_X_FORWARDED_HOST = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["accounts.permissions.ReadOnlyForViewer"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_RATES": {"login": "10/min", "setup": "10/min", "recovery": "5/min", "password": "10/min"},
    "UNAUTHENTICATED_USER": "django.contrib.auth.models.AnonymousUser",
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}
