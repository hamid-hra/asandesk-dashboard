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
# توکن agent محلی — volume مشترک بین backend و agent
AGENT_TOKEN_FILE = Path(env("AGENT_TOKEN_FILE", BASE_DIR / "data" / "agent" / "token"))


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
# پشت nginx: ارسال فایل با X-Accel-Redirect به‌جای خواندن در Django
USE_X_ACCEL_REDIRECT = env_bool("USE_X_ACCEL_REDIRECT", False)
X_ACCEL_PREFIX = "/_protected/releases/"

# مانیتورینگ
METRICS_RETENTION_DAYS = int(env("METRICS_RETENTION_DAYS", "90"))
SERVER_OFFLINE_AFTER_SECONDS = int(env("SERVER_OFFLINE_AFTER_SECONDS", "120"))

# کلاینت‌ها: heartbeat هر ۱۵ ثانیه است؛ بعد از این مدت بدون تماس «آفلاین» حساب می‌شوند
CLIENT_OFFLINE_AFTER_SECONDS = int(env("CLIENT_OFFLINE_AFTER_SECONDS", "60"))
CLIENT_TICKETS_PER_HOUR = int(env("CLIENT_TICKETS_PER_HOUR", "5"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env_bool("SECURE_COOKIES", False)
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
USE_X_FORWARDED_HOST = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["accounts.permissions.ReadOnlyForViewer"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_RATES": {"login": "10/min", "setup": "10/min"},
    "UNAUTHENTICATED_USER": "django.contrib.auth.models.AnonymousUser",
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}
