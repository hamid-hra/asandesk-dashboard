from datetime import timedelta

from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User

from .models import Kind, Notice, NoticeRead
from .service import INBOX_SIZE, ensure_version_notice, notice_row, visible_to

EXPIRY_DAYS = {"": None, "1": 1, "7": 7, "30": 30}


class InboxView(APIView):
    """GET /api/notices: the signed-in user's notices (newest first) and how many are unread."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_version_notice()
        qs = visible_to(request.user)
        rows = [notice_row(n) for n in qs.select_related("created_by")[:INBOX_SIZE]]
        return Response({"unread": qs.filter(is_read=False).count(), "results": rows})


class ReadView(APIView):
    """POST /api/notices/<pk>/read: dismiss one notice."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        notice = get_object_or_404(visible_to(request.user), pk=pk)
        NoticeRead.objects.get_or_create(notice=notice, user=request.user)
        return Response({"ok": True})


class ReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        unread = visible_to(request.user).filter(is_read=False)
        NoticeRead.objects.bulk_create([NoticeRead(notice=n, user=request.user) for n in unread], ignore_conflicts=True)
        return Response({"ok": True})


def audience_size(n: Notice) -> int:
    ids = list(n.recipients.values_list("pk", flat=True))
    if ids:
        return len(ids)
    return User.objects.filter(is_active=True, date_joined__lte=n.created_at).count()


def manage_row(n: Notice) -> dict:
    row = notice_row(n, read=False)
    row.pop("read")
    names = [u.display_name for u in n.recipients.all()]
    row.update(
        recipients=[u.pk for u in n.recipients.all()],
        recipient_names=names,
        audience=audience_size(n),
        reads=n.n_reads if hasattr(n, "n_reads") else n.reads.count(),
        expired=bool(n.expires_at and n.expires_at <= timezone.now()),
    )
    return row


class ManageListView(APIView):
    """/api/settings/notices (section «users»): sent notices with read counts, and sending a new one."""

    def get(self, request):
        ensure_version_notice()
        qs = Notice.objects.select_related("created_by").prefetch_related("recipients").annotate(n_reads=Count("reads"))[:100]
        return Response([manage_row(n) for n in qs])

    def post(self, request):
        d = request.data
        title = (d.get("title") or "").strip()
        body = (d.get("body") or "").strip()
        kind = d.get("kind") or Kind.INFO
        errors = {}
        if not title:
            errors["title"] = ["عنوان را وارد کنید."]
        elif len(title) > 120:
            errors["title"] = ["عنوان حداکثر ۱۲۰ نویسه است."]
        if len(body) > 4000:
            errors["body"] = ["متن حداکثر ۴۰۰۰ نویسه است."]
        if kind not in Kind.values:
            errors["kind"] = ["نوع اعلان نامعتبر است."]
        expiry = str(d.get("expires_days") or "")
        if expiry not in EXPIRY_DAYS:
            errors["expires_days"] = ["مدت نمایش نامعتبر است."]
        raw_ids = d.get("recipients") or []
        if not isinstance(raw_ids, list) or not all(isinstance(x, int) for x in raw_ids):
            errors["recipients"] = ["گیرندگان نامعتبرند."]
            raw_ids = []
        users = list(User.objects.filter(pk__in=raw_ids, is_active=True))
        if raw_ids and len(users) != len(set(raw_ids)):
            errors["recipients"] = ["بعضی از گیرندگان پیدا نشدند یا غیرفعال‌اند."]
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        days = EXPIRY_DAYS[expiry]
        notice = Notice.objects.create(
            title=title,
            body=body,
            kind=kind,
            popup=d.get("popup", True) is not False,
            created_by=request.user,
            expires_at=timezone.now() + timedelta(days=days) if days else None,
        )
        if users:
            notice.recipients.set(users)
        # فرستنده اگر خودش هم گیرنده است، اعلان را خوانده حساب می‌شود (در شمارش «دیده‌اند» نمی‌آید مگر گیرنده باشد)
        if not users or request.user in users:
            NoticeRead.objects.create(notice=notice, user=request.user)
        return Response(manage_row(notice), status=status.HTTP_201_CREATED)


class ManageDetailView(APIView):
    def delete(self, request, pk):
        notice = get_object_or_404(Notice, pk=pk)
        notice.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
