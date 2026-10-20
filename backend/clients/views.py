"""API پنل برای تب‌های «کلاینت‌ها» و «بازخوردها» (نشست Django، نقش ناظر فقط خواندن)."""

from datetime import timedelta

from django.db.models import Count, Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import stats
from .models import AccessToken, Client, Priority, Ticket, TicketImage, TicketStatus


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
        "contact": t.contact,
        "has_log": bool(t.log_file),
        # در فهرست از annotate(n_images) می‌آید؛ جزئیات خودش دوباره می‌شمارد
        "image_count": getattr(t, "n_images", 0),
        "client": client_brief(t.client),
    }


def ticket_detail(t: Ticket) -> dict:
    images = list(t.images.all())
    return {
        **ticket_row(t),
        "image_count": len(images),
        "diag": t.diag,
        "log": {"size": t.log_size, "files": t.log_files} if t.log_file else None,
        "images": [{"id": im.pk, "mime": im.mime, "size": im.size} for im in images],
        "messages": [
            {"id": m.pk, "from_client": m.from_client, "text": m.text, "created_at": m.created_at.isoformat()}
            for m in t.messages.all()
        ],
    }


# ---------- کلاینت‌ها ----------

def int_param(p, name: str, default: int) -> int:
    try:
        return int(p.get(name, default))
    except (TypeError, ValueError):
        return default


LEGACY_NOTE = "این دستگاه به API گزارش نمی‌دهد (نسخهٔ قدیمی)؛ این کار روی آن اثر ندارد."


class ClientListView(APIView):
    def get(self, request):
        p = request.query_params
        return Response(
            stats.client_rows(
                p.get("filter", "all"),
                p.get("sort", "recent"),
                p.get("q", "").strip()[:100],
                page=int_param(p, "page", 1),
                page_size=int_param(p, "page_size", stats.DEFAULT_PAGE_SIZE),
                platform=p.get("platform", "")[:32],
                os_name=p.get("os", "")[:200],
                version=p.get("version", "")[:32],
                seen=p.get("seen", ""),
                old=p.get("old") == "1",
                new=p.get("new") == "1",
                status=p.get("status", ""),
                account=p.get("account", ""),
                tickets=p.get("tickets") == "1",
                blocked=p.get("blocked") == "1",
                direction=p.get("dir", ""),
                legacy=p.get("legacy", ""),
            )
        )


class ClientStatsView(APIView):
    def get(self, request):
        return Response(stats.clients_summary())


class ClientChartsView(APIView):
    """Installs by version, platform and day for the «نمودارها» view (needs the clients section)."""

    def get(self, request):
        return Response(stats.install_charts())


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
            "legacy": c.legacy,
            "status_known": stats.legacy_status_known() or not c.legacy,
            "revoked_at": c.revoked_at.isoformat() if c.revoked_at else None,
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
        if c.legacy:
            return Response({"detail": LEGACY_NOTE}, status=status.HTTP_400_BAD_REQUEST)
        blocked = bool(request.data.get("blocked", True))
        # مسدودسازی: heartbeat بعدی دستگاه «blocked: true» می‌گیرد و اپلیکیشن اطلاعات سرور را از روی
        # دستگاه برمی‌دارد. رفع مسدودی: دستگاه در بررسی بعدی «blocked: false» می‌گیرد و اطلاعات برمی‌گردد.
        # حکم برای «ماشین» است: همهٔ شناسه‌هایی که uuid (شناسهٔ ماشین) یکسان دارند، چون با نصب دوباره
        # شناسهٔ تازه گرفته می‌شود ولی uuid همان می‌ماند.
        machine = Client.objects.filter(uuid_hash=c.uuid_hash) if c.uuid_hash else Client.objects.filter(pk=c.pk)
        machine.update(blocked=blocked, revoked_at=None)
        if blocked:
            # دستگاه مسدود از حساب هم خارج می‌شود
            AccessToken.objects.filter(client__in=machine).delete()
            machine.update(account=None)
        c.refresh_from_db()
        return Response({"blocked": c.blocked, "machines": machine.count()})


class ClientLogoutView(APIView):
    """خروج اجباری: توکن‌های این دستگاه باطل می‌شود؛ کلاینت در بررسی بعدی حساب از حساب خارج می‌شود."""

    def post(self, request, rd_id):
        c = get_object_or_404(Client, rd_id=rd_id)
        if c.legacy:
            return Response({"detail": LEGACY_NOTE}, status=status.HTTP_400_BAD_REQUEST)
        AccessToken.objects.filter(client=c).delete()
        c.account = None
        c.save(update_fields=["account"])
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- تیکت‌ها ----------

class TicketListView(APIView):
    def get(self, request):
        p = request.query_params
        qs = Ticket.objects.select_related("client__account").annotate(n_images=Count("images"))
        st = p.get("status", "open")
        if st in TicketStatus.values:
            qs = qs.filter(status=st)
        if p.get("contact") == "1":
            # فقط بازخوردهایی که کاربر راه تماس (شماره) گذاشته است
            qs = qs.exclude(contact="")
        q = p.get("q", "").strip()[:100]
        if q:
            cond = (Q(subject__icontains=q) | Q(contact__icontains=q) | Q(client__rd_id__icontains=q.replace(" ", ""))
                    | Q(client__hostname__icontains=q) | Q(client__account__name__icontains=q)
                    | Q(client__account__email__icontains=q))
            code = q.upper().removeprefix("T-")
            if code.isdigit() and int(code) > 1000:
                cond |= Q(pk=int(code) - 1000)
            qs = qs.filter(cond)
        # جدیدها: اول آن‌هایی که شماره تماس دارند (باید با آن‌ها تماس گرفت)، بعد فوری‌ها، بعد جدیدترها
        order = {Priority.URGENT: 0, Priority.HIGH: 1, Priority.NORMAL: 2, Priority.LOW: 3}
        rows = list(qs[:300])
        if st == TicketStatus.OPEN:
            rows.sort(key=lambda t: (not t.contact, order.get(t.priority, 2), -t.created_at.timestamp()))
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


class TicketImageView(APIView):
    """نمایش تصویری که همراه بازخورد فرستاده شده (فقط با دسترسی به بخش بازخوردها)."""

    def get(self, request, pk, image_id):
        im = get_object_or_404(TicketImage, pk=image_id, ticket_id=pk)
        resp = FileResponse(im.file.open("rb"), content_type=im.mime)
        # نوعِ ثبت‌شده را مرورگر عوض نکند و هیچ اسکریپتی از این پاسخ اجرا نشود
        resp["X-Content-Type-Options"] = "nosniff"
        resp["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
        resp["Cache-Control"] = "private, max-age=86400"
        return resp


def open_ticket_count() -> int:
    return Ticket.objects.filter(status=TicketStatus.OPEN).aggregate(n=Count("id"))["n"]
