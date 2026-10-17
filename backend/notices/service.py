from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from config.version import CHANGELOG, VERSION

from .models import Kind, Notice, NoticeRead

INBOX_SIZE = 30


def ensure_version_notice() -> None:
    """Once per panel version: a «panel updated» notice with that version's changelog, for everyone.

    Created lazily on the first inbox read after an update (no startup hook needed). On a brand-new
    install there is nothing «new» to tell, so the notice is created already read by everyone.
    """
    if Notice.objects.filter(version=VERSION).exists():
        return
    from accounts.models import User

    entry = CHANGELOG[0]
    try:
        with transaction.atomic():
            notice = Notice.objects.create(
                version=VERSION,
                kind=Kind.UPDATE,
                title=f"پنل به نسخهٔ {VERSION} به‌روز شد",
                body=entry.get("title", ""),
                items=[[kind, text] for kind, text in entry.get("items", [])],
                popup=True,
            )
            fresh = not User.objects.filter(date_joined__lt=timezone.now() - timedelta(hours=1)).exists()
            if fresh:
                NoticeRead.objects.bulk_create([NoticeRead(notice=notice, user=u) for u in User.objects.all()])
    except IntegrityError:
        pass  # another worker created it at the same moment


def visible_to(user):
    """Notices this user receives: addressed to everyone or to them, not expired, not older than the account."""
    now = timezone.now()
    return (
        Notice.objects.filter(Q(recipients__isnull=True) | Q(recipients=user))
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .filter(created_at__gte=user.date_joined)
        .distinct()
        .annotate(is_read=Exists(NoticeRead.objects.filter(notice=OuterRef("pk"), user=user)))
    )


def notice_row(n: Notice, read: bool | None = None) -> dict:
    by = n.created_by
    return {
        "id": n.pk,
        "title": n.title,
        "body": n.body,
        "kind": n.kind,
        "popup": n.popup,
        "version": n.version,
        "items": n.items or [],
        "created_at": n.created_at.isoformat(),
        "expires_at": n.expires_at.isoformat() if n.expires_at else None,
        "by": by.display_name if by else "",
        "read": bool(getattr(n, "is_read", False) if read is None else read),
    }
