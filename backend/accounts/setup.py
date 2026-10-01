"""راه‌اندازی اولیه: ساخت حساب مالک در اولین ورود.

تا وقتی هیچ کاربری وجود ندارد، صفحه ورود فرم «ساخت حساب مالک» را نشان می‌دهد.
برای اینکه کسی جز صاحب سرور نتواند زودتر مالک شود، یک کد یک‌بارمصرف در لاگ backend
چاپ می‌شود (`docker compose logs backend`) و فرم بدون آن پذیرفته نمی‌شود.
"""

import hmac
import os
import secrets

from django.conf import settings

from .models import User

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # بدون حروف مبهم (O/0، I/1)


def code_path():
    return settings.SECRETS_DIR / "setup_code"


def setup_needed() -> bool:
    return not User.objects.exists()


def normalize(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def ensure_setup_code() -> str | None:
    """اگر راه‌اندازی لازم است کد را برمی‌گرداند (در صورت نبود، می‌سازد)."""
    if not setup_needed():
        clear_setup_code()
        return None
    path = code_path()
    try:
        code = path.read_text().strip()
        if code:
            return code
    except OSError:
        pass
    raw = "".join(secrets.choice(ALPHABET) for _ in range(12))
    code = "-".join(raw[i : i + 4] for i in range(0, 12, 4))
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(code)
    return code


def check_setup_code(given: str) -> bool:
    try:
        expected = code_path().read_text().strip()
    except OSError:
        return False
    return bool(expected) and hmac.compare_digest(normalize(given), normalize(expected))


def clear_setup_code() -> None:
    try:
        code_path().unlink()
    except FileNotFoundError:
        pass
