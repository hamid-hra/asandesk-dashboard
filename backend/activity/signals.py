from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed
from django.dispatch import receiver

from .service import record


@receiver(user_logged_in)
def on_login(sender, request, user, **kwargs):
    record("auth.login", "وارد پنل شد", request=request, user=user)


@receiver(user_logged_out)
def on_logout(sender, request, user, **kwargs):
    if user is not None:
        record("auth.logout", "از پنل خارج شد", request=request, user=user)


@receiver(user_login_failed)
def on_login_failed(sender, credentials, request=None, **kwargs):
    # رمز هرگز ذخیره نمی‌شود؛ فقط نام کاربری که تلاش شده
    name = str((credentials or {}).get("username") or "")[:150]
    record("auth.login_failed", f"ورود ناموفق با نام کاربری «{name}»", request=request, username=name, ok=False)
