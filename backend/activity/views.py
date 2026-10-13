"""GET /api/settings/activity — the activity log, newest first (section «activity», view level)."""

from datetime import datetime, time, timedelta

from django.db.models import Count, Max
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User

from .models import ActivityLog

PAGE = 50
MAX_PAGE = 100


def row(a: ActivityLog) -> dict:
    return {
        "id": a.pk,
        "ts": a.created_at.isoformat(),
        "username": a.username,
        "display_name": a.display_name or a.username,
        "action": a.action,
        "category": a.category,
        "text": a.text,
        "ok": a.ok,
        "ip": a.ip,
    }


def _day(value: str | None, end: bool = False):
    """«YYYY-MM-DD» → the start (or end) of that day in the panel's time zone."""
    try:
        d = datetime.strptime(value or "", "%Y-%m-%d").date()
    except ValueError:
        return None
    start = timezone.make_aware(datetime.combine(d, time.min))
    return start + timedelta(days=1) if end else start


def people() -> list[dict]:
    """Everyone who appears in the log, most recently active first, with their current display name."""
    agg = list(
        ActivityLog.objects.exclude(username="").values("username").annotate(n=Count("id"), last=Max("created_at")).order_by("-last")
    )
    current = {u.username: u for u in User.objects.filter(username__in=[a["username"] for a in agg])}
    out = []
    for a in agg:
        u = current.get(a["username"])
        if u:
            name = u.display_name
        else:  # حساب حذف شده: آخرین نامی که در لاگ ثبت شده
            name = ActivityLog.objects.filter(username=a["username"]).values_list("display_name", flat=True).first() or a["username"]
        out.append({"username": a["username"], "display_name": name, "count": a["n"], "last": a["last"].isoformat(), "exists": u is not None})
    return out


class ActivityListView(APIView):
    def get(self, request):
        p = request.query_params
        qs = ActivityLog.objects.all()
        if p.get("user"):
            qs = qs.filter(username=p["user"])
        if p.get("category"):
            qs = qs.filter(category=p["category"])
        if p.get("ok") in ("0", "false"):
            qs = qs.filter(ok=False)
        if p.get("q"):
            qs = qs.filter(text__icontains=p["q"].strip()[:100])
        since, until = _day(p.get("since")), _day(p.get("until"), end=True)
        if since:
            qs = qs.filter(created_at__gte=since)
        if until:
            qs = qs.filter(created_at__lt=until)
        before = p.get("before")
        if before and before.isdigit():
            qs = qs.filter(pk__lt=int(before))
        try:
            limit = max(1, min(int(p.get("limit", PAGE)), MAX_PAGE))
        except ValueError:
            limit = PAGE

        items = list(qs[: limit + 1])
        more = len(items) > limit
        items = items[:limit]
        body = {"rows": [row(a) for a in items], "next": items[-1].pk if more and items else None}
        if not before:  # اولین صفحه: فهرست افراد برای فیلتر
            body["people"] = people()
        return Response(body)
