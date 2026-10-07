"""API پنل برای تب‌های «کلاینت‌ها» و «تیکت‌ها» (نشست Django، نقش ناظر فقط خواندن)."""

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import stats
from .models import AccessToken, Client, Priority, Ticket, TicketMessage, TicketStatus


def client_brief(c: Client) -> dict:
    return {
        "id": c.rd_id,
        "display": c.display_name,
        "logged": c.account_id is not None,
        "plan": c.account.plan if c.account_id else "free",
        "online": c.online,
        "last_seen": c.last_seen.isoformat() if c.last_seen else None,
    }


def ticket_row(t: Ticket) -> dict:
    return {
        "id": t.pk,
        "code": t.code,
        "subject": t.subject,
        "category": t.category,
        "priority": t.priority,
        "status": t.status,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat(),
        "has_log": bool(t.log_file),
        "client": client_brief(t.client),
    }


def ticket_detail(t: Ticket) -> dict:
    return {
        **ticket_row(t),
        "diag": t.diag,
        "contact": t.contact,
        "log": {"size": t.log_size, "files": t.log_files} if t.log_file else None,
        "messages": [
            {
                "id": m.pk,
                "from_client": m.from_client,
                "author": (m.author.display_name if m.author else "") if not m.from_client else "",
                "text": m.text,
                "created_at": m.created_at.isoformat(),
            }
            for m in t.messages.select_related("author")
        ],
    }


# ---------- کلاینت‌ها ----------

class ClientListView(APIView):
    def get(self, request):
        p = request.query_params
        return Response(stats.client_rows(p.get("filter", "all"), p.get("sort", "recent"), p.get("q", "").strip()[:100]))


class ClientStatsView(APIView):
    def get(self, request):
        return Response(stats.clients_summary())


class ClientDetailView(APIView):
    def get(self, request, rd_id):
        stats.close_stale_sessions()
        c = get_object_or_404(Client.objects.select_related("account"), rd_id=rd_id)
        since = timezone.now() - timedelta(days=30)
        n, secs = stats.usage_by_client(since).get(c.pk, (0, 0.0))
        latest = stats.latest_stable_version()
        sessions = []
        for x in stats.client_sessions(c).filter(authorized_at__isnull=False)[:5]:
            outgoing = x.client_id != c.pk  # این کلاینت کنترل‌کننده بوده
            sessions.append({
                "peer": x.client.rd_id if outgoing else x.peer_id,
                "peer_name": x.client.display_name if outgoing else x.peer_name,
                "outgoing": outgoing,
                "type": x.conn_type,
                "minutes": round(x.duration.total_seconds() / 60),
                "active": x.ended_at is None,
                "at": x.authorized_at.isoformat(),
            })
        tickets = c.tickets.all()[:20]
        return Response({
            "id": c.rd_id,
            "display": c.display_name,
            "hostname": c.hostname,
            "os_user": c.os_user,
            "email": c.account.email if c.account_id else "",
            "logged": c.account_id is not None,
            "plan": c.account.plan if c.account_id else "free",
            "online": c.online,
            "blocked": c.blocked,
            "last_seen": c.last_seen.isoformat() if c.last_seen else None,
            "first_seen": c.first_seen.isoformat(),
            "os": c.os,
            "platform": c.platform,
            "cpu": c.cpu,
            "memory": c.memory,
            "version": c.version,
            "version_old": stats.version_old(c.version, latest),
            "ip": c.ip,
            "devices": c.account.clients.count() if c.account_id else 1,
            "mins_30d": round(secs / 60),
            "sessions_30d": n,
            "daily": stats.daily_minutes(c),
            "sessions": sessions,
            "tickets": [{"id": t.pk, "code": t.code, "subject": t.subject, "status": t.status} for t in tickets],
        })


class ClientBlockView(APIView):
    def post(self, request, rd_id):
        c = get_object_or_404(Client, rd_id=rd_id)
        c.blocked = bool(request.data.get("blocked", True))
        c.save(update_fields=["blocked"])
        if c.blocked:
            # دستگاه مسدود از حساب هم خارج می‌شود
            AccessToken.objects.filter(client=c).delete()
            Client.objects.filter(pk=c.pk).update(account=None)
        return Response({"blocked": c.blocked})


class ClientLogoutView(APIView):
    """خروج اجباری: توکن‌های این دستگاه باطل می‌شود؛ کلاینت در بررسی بعدی حساب از حساب خارج می‌شود."""

    def post(self, request, rd_id):
        c = get_object_or_404(Client, rd_id=rd_id)
        AccessToken.objects.filter(client=c).delete()
        c.account = None
        c.save(update_fields=["account"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClientMessageView(APIView):
    """پیام پشتیبانی به کلاینت = تیکتی که پشتیبانی شروع می‌کند (در اپلیکیشن در فهرست تیکت‌ها دیده می‌شود)."""

    def post(self, request, rd_id):
        c = get_object_or_404(Client, rd_id=rd_id)
        subject = str(request.data.get("subject") or "").strip()[:200]
        text = str(request.data.get("text") or "").strip()[:5000]
        if not subject or not text:
            return Response({"detail": "موضوع و متن پیام را وارد کنید."}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        with transaction.atomic():
            t = Ticket.objects.create(
                client=c, subject=subject, category="پیام پشتیبانی", status=TicketStatus.PENDING,
                created_at=now, first_response_at=now,
            )
            TicketMessage.objects.create(ticket=t, from_client=False, author=request.user, text=text, created_at=now)
        return Response(ticket_detail(t), status=status.HTTP_201_CREATED)


# ---------- تیکت‌ها ----------

class TicketListView(APIView):
    def get(self, request):
        p = request.query_params
        qs = Ticket.objects.select_related("client__account")
        st = p.get("status", "open")
        if st in TicketStatus.values:
            qs = qs.filter(status=st)
        q = p.get("q", "").strip()[:100]
        if q:
            cond = (Q(subject__icontains=q) | Q(client__rd_id__icontains=q.replace(" ", ""))
                    | Q(client__hostname__icontains=q) | Q(client__account__name__icontains=q)
                    | Q(client__account__email__icontains=q))
            code = q.upper().removeprefix("T-")
            if code.isdigit() and int(code) > 1000:
                cond |= Q(pk=int(code) - 1000)
            qs = qs.filter(cond)
        # فوری‌ها بالاتر، بعد جدیدترها
        order = {Priority.URGENT: 0, Priority.HIGH: 1, Priority.NORMAL: 2, Priority.LOW: 3}
        rows = list(qs[:300])
        if st in (TicketStatus.OPEN, TicketStatus.PENDING):
            rows.sort(key=lambda t: (order.get(t.priority, 2), -t.created_at.timestamp()))
        return Response([ticket_row(t) for t in rows])


class TicketStatsView(APIView):
    def get(self, request):
        return Response(stats.tickets_summary())


class TicketDetailView(APIView):
    def get(self, request, pk):
        t = get_object_or_404(Ticket.objects.select_related("client__account"), pk=pk)
        return Response(ticket_detail(t))

    def patch(self, request, pk):
        t = get_object_or_404(Ticket.objects.select_related("client__account"), pk=pk)
        new = request.data.get("status")
        if new not in TicketStatus.values:
            return Response({"status": ["وضعیت نامعتبر است."]}, status=status.HTTP_400_BAD_REQUEST)
        t.set_status(new)
        t.save(update_fields=["status", "closed_at", "updated_at"])
        return Response(ticket_detail(t))


class TicketLogView(APIView):
    """دانلود لاگ برنامه‌ای که همراه بازخورد فرستاده شده (فقط با دسترسی به بخش بازخوردها)."""

    def get(self, request, pk):
        t = get_object_or_404(Ticket.objects.select_related("client"), pk=pk)
        if not t.log_file:
            raise Http404
        name = f"AsanDesk-{t.code}-{t.client.rd_id}.log"
        resp = FileResponse(
            t.log_file.open("rb"), as_attachment=True, filename=name, content_type="text/plain; charset=utf-8"
        )
        resp["Cache-Control"] = "private, no-store"
        resp["X-Content-Type-Options"] = "nosniff"
        return resp


class TicketReplyView(APIView):
    def post(self, request, pk):
        t = get_object_or_404(Ticket.objects.select_related("client__account"), pk=pk)
        text = str(request.data.get("text") or "").strip()[:5000]
        if not text:
            return Response({"text": ["متن پاسخ را وارد کنید."]}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        with transaction.atomic():
            TicketMessage.objects.create(ticket=t, from_client=False, author=request.user, text=text, created_at=now)
            if t.first_response_at is None:
                t.first_response_at = now
            t.set_status(TicketStatus.CLOSED if request.data.get("close") else TicketStatus.PENDING)
            t.save(update_fields=["status", "closed_at", "first_response_at", "updated_at"])
        return Response(ticket_detail(t))


def open_ticket_count() -> int:
    return Ticket.objects.filter(status=TicketStatus.OPEN).aggregate(n=Count("id"))["n"]
