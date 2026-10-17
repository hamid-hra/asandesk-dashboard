"""GET /api/search?q=: the panel-wide search box (Ctrl+K).

Each group is searched only when the user may view that section, so the results never show more
than the pages themselves would. The pages and settings tabs are matched in the browser.
"""

import re

from django.db.models import Q
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from clients.models import TICKET_NUMBER_BASE, Client, Ticket
from monitoring.models import Server
from releases.models import Release

PER_GROUP = 6
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _clients(q: str, digits: str) -> list[dict]:
    cond = Q(hostname__icontains=q) | Q(account__email__icontains=q) | Q(account__name__icontains=q) | Q(os_user__icontains=q)
    if digits:
        cond |= Q(rd_id__icontains=digits)
    if re.fullmatch(r"[\d.:a-fA-F]{3,}", q):
        cond |= Q(ip__startswith=q)
    qs = Client.objects.select_related("account").filter(cond).order_by("-last_seen")[:PER_GROUP]
    return [
        {"id": c.rd_id, "title": c.display_name, "sub": " · ".join(x for x in (c.rd_id, c.platform, c.version) if x), "href": f"/clients?id={c.rd_id}", "online": c.online}
        for c in qs
    ]


def _tickets(q: str, digits: str) -> list[dict]:
    cond = Q(subject__icontains=q) | Q(contact__icontains=q) | Q(client__rd_id__icontains=digits or q) | Q(client__hostname__icontains=q)
    m = re.fullmatch(r"(?:t-?)?(\d+)", q.lower().translate(DIGITS))
    if m and int(m.group(1)) > TICKET_NUMBER_BASE:
        cond |= Q(pk=int(m.group(1)) - TICKET_NUMBER_BASE)
    qs = Ticket.objects.select_related("client").filter(cond).order_by("-created_at")[:PER_GROUP]
    return [{"id": t.pk, "title": t.subject or t.code, "sub": f"{t.code} · {t.get_status_display()}", "href": f"/tickets?id={t.pk}"} for t in qs]


def _releases(q: str) -> list[dict]:
    qs = Release.objects.filter(Q(version__icontains=q) | Q(notes__icontains=q) | Q(message__icontains=q))[:PER_GROUP]
    return [{"id": r.version, "title": r.version, "sub": f"{r.get_channel_display()} · {r.published_on.isoformat()}", "href": f"/releases?v={r.version}"} for r in qs]


def _users(q: str, digits: str) -> list[dict]:
    cond = Q(username__icontains=q) | Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(email__icontains=q)
    if digits:
        cond |= Q(phone__icontains=digits)
    qs = User.objects.filter(cond).order_by("date_joined")[:PER_GROUP]
    return [{"id": u.pk, "title": u.display_name, "sub": f"{u.username} · {u.get_role_display()}", "href": f"/settings?tab=users&q={u.username}"} for u in qs]


def _servers(q: str) -> list[dict]:
    qs = Server.objects.filter(Q(name__icontains=q) | Q(region__icontains=q) | Q(ip__startswith=q) | Q(hostname__icontains=q))[:PER_GROUP]
    return [{"id": s.pk, "title": s.name, "sub": " · ".join(x for x in (s.region, s.ip) if x), "href": "/server"} for s in qs]


class SearchView(APIView):
    def get(self, request):
        q = (request.query_params.get("q") or "").strip()[:80]
        if len(q) < 2:
            return Response({"q": q, "groups": []})
        digits = re.sub(r"\D", "", q.translate(DIGITS)) if re.fullmatch(r"[\d\s۰-۹٠-٩-]+", q) else ""
        user = request.user
        can = lambda section: user.level(section) in ("view", "edit")  # noqa: E731
        groups = []
        if can("clients"):
            groups.append(("clients", "کلاینت‌ها", _clients(q, digits)))
        if can("tickets"):
            groups.append(("tickets", "بازخوردها", _tickets(q, digits)))
        if can("release"):
            groups.append(("releases", "نسخه‌ها", _releases(q)))
        if can("server"):
            groups.append(("servers", "سرورها", _servers(q)))
        if can("users"):
            groups.append(("users", "کاربران پنل", _users(q, digits)))
        return Response({"q": q, "groups": [{"id": gid, "label": label, "items": items} for gid, label, items in groups if items]})
