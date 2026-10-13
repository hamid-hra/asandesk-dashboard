"""Writing the activity log. Logging must never break the request it describes."""

import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import ActivityLog

log = logging.getLogger(__name__)

TEXT_MAX = 400


def client_ip(request) -> str:
    # nginx آدرس واقعی را در X-Real-IP می‌گذارد (مثل clients/client_api.py)
    meta = getattr(request, "META", {})
    return (meta.get("HTTP_X_REAL_IP") or meta.get("REMOTE_ADDR") or "")[:64]


def record(action: str, text: str, *, request=None, user=None, username: str = "", ok: bool = True) -> None:
    """Add one row. Any failure is logged and swallowed."""
    try:
        if user is None and request is not None:
            candidate = getattr(request, "user", None)
            user = candidate if getattr(candidate, "is_authenticated", False) else None
        if user is not None:
            username = user.get_username()
            display = user.display_name if hasattr(user, "display_name") else username
        else:
            display = username
        ActivityLog.objects.create(
            user=user,
            username=(username or "")[:150],
            display_name=(display or "")[:150],
            action=action[:64],
            category=action.split(".")[0][:24],
            text=text[:TEXT_MAX],
            ok=ok,
            ip=client_ip(request) if request is not None else "",
        )
    except Exception:  # noqa: BLE001
        log.exception("activity log write failed (%s)", action)


def note(request, text: str, action: str | None = None) -> None:
    """Let a view describe what it just did, in more detail than the route table can.

    The middleware writes the row after the response; this text (and action) replaces its default.
    """
    target = getattr(request, "_request", request)
    target.activity_note = (action, text)


def purge(days: int | None = None) -> int:
    """Delete rows older than `days` (default: ACTIVITY_KEEP_DAYS). Returns how many."""
    days = settings.ACTIVITY_KEEP_DAYS if days is None else days
    if days <= 0:
        return 0
    deleted, _ = ActivityLog.objects.filter(created_at__lt=timezone.now() - timedelta(days=days)).delete()
    return deleted
