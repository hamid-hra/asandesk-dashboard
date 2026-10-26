"""بخش «کاربران وب» در پنل مالک (زیر /api/webusers؛ دسترسی همان بخش «کلاینت‌ها»)."""

import secrets
import string
from datetime import timedelta

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Direction, WebConnection, WebSession, WebUser

PAGE = 50
# کاربری که در این مدت درخواستی زده (صفحه را باز نگه داشته) «آنلاین» دیده می‌شود
ONLINE_WINDOW = timedelta(minutes=3)


def row(u: WebUser, now) -> dict:
    return {
        "id": u.pk,
        "name": u.name,
        "display_name": u.display_name,
        "email": u.email or "",
        "phone": u.phone or "",
        "web_id": u.web_id,
        "blocked": u.is_blocked,
        "online": bool(u.last_seen_at and now - u.last_seen_at < ONLINE_WINDOW),
        "created_at": u.created_at.isoformat(),
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None,
        "last_ip": u.last_ip,
    }


class WebUserListView(APIView):
    section = "clients"

    def get(self, request):
        p = request.query_params
        qs = WebUser.objects.all()
        q = p.get("q", "").strip()[:100]
        if q:
            qs = qs.filter(
                Q(display_name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q) | Q(web_id__icontains=q.replace(" ", ""))
            )
        flt = p.get("filter", "all")
        now = timezone.now()
        if flt == "blocked":
            qs = qs.filter(is_blocked=True)
        elif flt == "online":
            qs = qs.filter(last_seen_at__gte=now - ONLINE_WINDOW)
        try:
            page = max(1, int(p.get("page", "1")))
        except ValueError:
            page = 1
        total = qs.count()
        users = qs.order_by("-created_at")[(page - 1) * PAGE: page * PAGE]
        week = now - timedelta(days=7)
        return Response({
            "rows": [row(u, now) for u in users],
            "total": total,
            "page": page,
            "pages": max(1, (total + PAGE - 1) // PAGE),
            "summary": {
                "total": WebUser.objects.count(),
                "new_7d": WebUser.objects.filter(created_at__gte=week).count(),
                "online": WebUser.objects.filter(last_seen_at__gte=now - ONLINE_WINDOW).count(),
                "blocked": WebUser.objects.filter(is_blocked=True).count(),
            },
        })


class WebUserDetailView(APIView):
    section = "clients"

    def get(self, request, pk):
        u = get_object_or_404(WebUser, pk=pk)
        now = timezone.now()
        # order_by() خالی: ترتیب پیش‌فرض مدل وارد GROUP BY نشود
        counts = dict(u.connections.order_by().values("direction").annotate(n=Count("id")).values_list("direction", "n"))
        conns = [
            {
                "direction": c.direction,
                "peer_id": c.peer_id,
                "peer_name": c.peer_name,
                "started_at": c.started_at.isoformat(),
                "ended_at": c.ended_at.isoformat() if c.ended_at else None,
                "ip": c.ip,
            }
            for c in u.connections.all()[:30]
        ]
        return Response({
            **row(u, now),
            "signup_ip": u.signup_ip,
            "sessions": u.sessions.filter(expires_at__gt=now).count(),
            "devices": u.devices.count(),
            "out_count": counts.get(Direction.OUT, 0),
            "in_count": counts.get(Direction.IN, 0),
            "connections": conns,
        })

    def delete(self, request, pk):
        u = get_object_or_404(WebUser, pk=pk)
        u.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WebUserBlockView(APIView):
    section = "clients"

    def post(self, request, pk):
        u = get_object_or_404(WebUser, pk=pk)
        u.is_blocked = bool(request.data.get("blocked", True))
        u.save(update_fields=["is_blocked"])
        if u.is_blocked:
            # همهٔ ورودهای باز بسته می‌شود؛ درگاه وب در بررسی بعدی هم کد او را از سرور شناسه برمی‌دارد
            WebSession.objects.filter(user=u).delete()
        return Response({"blocked": u.is_blocked})


class WebUserPasswordView(APIView):
    """کاربر رمزش را فراموش کرده: رمز تازهٔ تصادفی که یک بار به مالک نشان داده می‌شود تا به کاربر بگوید."""

    section = "clients"

    def post(self, request, pk):
        u = get_object_or_404(WebUser, pk=pk)
        alphabet = string.ascii_letters + string.digits
        password = "".join(secrets.choice(alphabet) for _ in range(12))
        u.set_password(password)
        u.save(update_fields=["password"])
        WebSession.objects.filter(user=u).delete()
        return Response({"password": password})
