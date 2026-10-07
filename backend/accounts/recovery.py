"""One-time recovery codes.

A user who forgot the password can set a new one from the login page with the username and
one of the codes saved earlier. No email or SMTP server is needed.

Codes are 12 random characters (60 bits) shown to the user once; only an HMAC of each code
is stored (keyed with SECRET_KEY, which is not in the database).
"""
import hashlib
import hmac
import secrets

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import RecoveryCode

COUNT = 10
CODE_LEN = 12
# No 0/O and 1/I, so a code is easy to read from paper
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))
    return "-".join(raw[i : i + 4] for i in range(0, CODE_LEN, 4))


def normalize(code: str) -> str:
    """Case, dashes and spaces do not matter when the code is typed."""
    return "".join(ch for ch in (code or "").upper() if ch in ALPHABET)


def digest(user_id, code: str) -> str:
    msg = f"recovery:{user_id}:{normalize(code)}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def generate_for(user) -> list[str]:
    """Replaces all codes of the user with a fresh set and returns them (the only time they are visible)."""
    codes = [new_code() for _ in range(COUNT)]
    with transaction.atomic():
        RecoveryCode.objects.filter(user=user).delete()
        RecoveryCode.objects.bulk_create(RecoveryCode(user=user, code_hash=digest(user.pk, c)) for c in codes)
    return codes


def remaining(user) -> int:
    return RecoveryCode.objects.filter(user=user, used_at__isnull=True).count()


def is_valid(user, code: str) -> bool:
    return RecoveryCode.objects.filter(user=user, code_hash=digest(user.pk, code), used_at__isnull=True).exists()


def consume(user, code: str) -> bool:
    """Marks the code as used. One atomic UPDATE, so two requests can never both succeed."""
    n = RecoveryCode.objects.filter(user=user, code_hash=digest(user.pk, code), used_at__isnull=True).update(
        used_at=timezone.now()
    )
    return n == 1
