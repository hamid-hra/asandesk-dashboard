"""محاسبه آمار کلاینت‌ها و تیکت‌ها برای پنل."""

from collections import Counter
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import connection
from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import TruncDate
from django.utils import timezone

from releases.models import Channel
from releases.services import latest_release

from .models import Client, ConnSession, Ticket, TicketStatus, platform_of


def close_stale_sessions():
    """اتصال‌های باز دستگاه‌هایی که دیگر گزارش نمی‌دهند در زمان آخرین تماس بسته می‌شوند."""
    cutoff = timezone.now() - timedelta(seconds=settings.CLIENT_OFFLINE_AFTER_SECONDS)
    last_seen = Client.objects.filter(pk=OuterRef("client_id")).values("last_seen")[:1]
    ConnSession.objects.filter(ended_at__isnull=True, client__last_seen__lt=cutoff).update(
        ended_at=Subquery(last_seen)
    )


def usage_by_client(since) -> dict[int, tuple[int, float]]:
    """{client_id: (تعداد نشست، ثانیه اتصال)} — هر نشست برای هر دو طرف (کنترل‌شونده و کنترل‌کننده) شمرده می‌شود."""
    sess, cli = ConnSession._meta.db_table, Client._meta.db_table
    sql = f"""
        WITH s AS (
            SELECT client_id AS cid, authorized_at, ended_at FROM {sess}
            WHERE authorized_at >= %s
            UNION ALL
            SELECT c.id, x.authorized_at, x.ended_at FROM {sess} x JOIN {cli} c ON c.rd_id = x.peer_id
            WHERE x.authorized_at >= %s AND x.peer_id <> ''
        )
        SELECT cid, count(*), coalesce(sum(extract(epoch FROM (coalesce(ended_at, now()) - authorized_at))), 0)
        FROM s GROUP BY cid
    """
    with connection.cursor() as cur:
        cur.execute(sql, [since, since])
        return {cid: (n, max(0.0, float(secs))) for cid, n, secs in cur.fetchall()}


def client_sessions(client: Client):
    """نشست‌های یک کلاینت از هر دو سو."""
    return ConnSession.objects.filter(Q(client=client) | Q(peer_id=client.rd_id)).select_related("client")


def latest_stable_version() -> str | None:
    r = latest_release([Channel.STABLE])
    return r.version if r else None


def version_old(version: str, latest: str | None) -> bool:
    return bool(latest and version and "-" not in version and version != latest)


def client_rows(filter_: str, sort: str, q: str, limit: int = 300):
    close_stale_sessions()
    now = timezone.now()
    usage = usage_by_client(now - timedelta(days=30))
    latest = latest_stable_version()
    qs = Client.objects.select_related("account").annotate(
        t_open=Count("tickets", filter=~Q(tickets__status=TicketStatus.CLOSED)),
        t_total=Count("tickets"),
    )
    if q:
        digits = q.replace(" ", "")
        qs = qs.filter(
            Q(rd_id__icontains=digits) | Q(hostname__icontains=q) | Q(account__email__icontains=q)
            | Q(account__name__icontains=q) | Q(ip__startswith=q)
        )
    online_after = now - timedelta(seconds=settings.CLIENT_OFFLINE_AFTER_SECONDS)
    if filter_ == "online":
        qs = qs.filter(last_seen__gte=online_after)
    elif filter_ == "logged":
        qs = qs.filter(account__isnull=False)
    elif filter_ == "guest":
        qs = qs.filter(account__isnull=True)
    elif filter_ == "tickets":
        qs = qs.filter(t_open__gt=0)
    elif filter_ == "blocked":
        qs = qs.filter(blocked=True)

    rows = []
    for c in qs:
        n, secs = usage.get(c.pk, (0, 0.0))
        rows.append({
            "id": c.rd_id,
            "display": c.display_name,
            "hostname": c.hostname,
            "email": c.account.email if c.account_id else "",
            "logged": c.account_id is not None,
            "plan": c.account.plan if c.account_id else "free",
            "online": c.online,
            "last_seen": c.last_seen.isoformat() if c.last_seen else None,
            "os": c.os,
            "platform": c.platform,
            "version": c.version,
            "version_old": version_old(c.version, latest),
            "ip": c.ip,
            "mins_30d": round(secs / 60),
            "sessions_30d": n,
            "tickets_open": c.t_open,
            "tickets_total": c.t_total,
            "blocked": c.blocked,
        })
    sorters = {
        "recent": lambda r: (not r["online"], -(datetime.fromisoformat(r["last_seen"]).timestamp() if r["last_seen"] else 0)),
        "mins": lambda r: -r["mins_30d"],
        "sessions": lambda r: -r["sessions_30d"],
        "tickets": lambda r: (-r["tickets_open"], -r["tickets_total"]),
    }
    rows.sort(key=sorters.get(sort, sorters["recent"]))
    return {"count": len(rows), "results": rows[:limit]}


def clients_summary():
    close_stale_sessions()
    now = timezone.now()
    since = now - timedelta(days=30)
    total = Client.objects.count()
    active = Client.objects.filter(last_seen__gte=since)
    active_n = active.count()
    usage = usage_by_client(since)
    total_secs = sum(secs for _, secs in usage.values())
    platforms = Counter(c.platform or "نامشخص" for c in active.only("os"))
    return {
        "total": total,
        "new_7d": Client.objects.filter(first_seen__gte=now - timedelta(days=7)).count(),
        "online": Client.objects.filter(
            last_seen__gte=now - timedelta(seconds=settings.CLIENT_OFFLINE_AFTER_SECONDS)
        ).count(),
        "active_30d": active_n,
        "logged_share": round(active.filter(account__isnull=False).count() / active_n * 100, 1) if active_n else None,
        # میانگین دقیقه اتصال در روز برای هر کلاینت فعال
        "avg_daily_minutes": round(total_secs / 60 / active_n / 30, 1) if active_n else None,
        "sessions_30d": ConnSession.objects.filter(authorized_at__gte=since).count(),
        "with_open_tickets": Client.objects.filter(tickets__status=TicketStatus.OPEN)
        .distinct().count(),
        "platforms": [[p, n / active_n] for p, n in platforms.most_common()] if active_n else [],
    }


def daily_minutes(client: Client, days: int = 14) -> list[float]:
    """دقیقه اتصال روزانه (به وقت محلی) برای چند روز اخیر؛ آخرین عنصر امروز است."""
    today = timezone.localdate()
    start = timezone.make_aware(datetime.combine(today - timedelta(days=days - 1), time.min))
    out = [0.0] * days
    now = timezone.now()
    for s in client_sessions(client).filter(authorized_at__isnull=False).filter(
        Q(ended_at__isnull=True) | Q(ended_at__gte=start)
    ):
        a, b = max(s.authorized_at, start), s.ended_at or now
        # نشستی که از نیمه‌شب رد شود بین روزها تقسیم می‌شود
        while a < b:
            day = timezone.localtime(a).date()
            next_midnight = timezone.make_aware(datetime.combine(day + timedelta(days=1), time.min))
            end = min(b, next_midnight)
            idx = (day - (today - timedelta(days=days - 1))).days
            if 0 <= idx < days:
                out[idx] += (end - a).total_seconds() / 60
            a = end
    return [round(x, 1) for x in out]


def tickets_summary():
    """شمارش بازخوردها: جدید، بررسی‌شده، و جدیدهایی که شماره تماس دارند (باید با آن‌ها تماس گرفت)."""
    counts = dict(Ticket.objects.values_list("status").annotate(n=Count("id")))
    return {
        "open": counts.get(TicketStatus.OPEN, 0),
        "closed": counts.get(TicketStatus.CLOSED, 0),
        "open_with_contact": Ticket.objects.filter(status=TicketStatus.OPEN).exclude(contact="").count(),
        "last_7d": Ticket.objects.filter(created_at__gte=timezone.now() - timedelta(days=7)).count(),
    }


def version_distribution():
    """سهم نسخه‌ها بین کلاینت‌های فعال ۳۰ روز اخیر (برای تب نسخه‌ها)."""
    since = timezone.now() - timedelta(days=30)
    rows = list(
        Client.objects.filter(last_seen__gte=since).exclude(version="")
        .values("version").annotate(n=Count("id")).order_by("-n")
    )
    total = sum(r["n"] for r in rows)
    if not total:
        return None, None
    latest = latest_stable_version()
    on_current = next((r["n"] for r in rows if r["version"] == latest), 0)
    top = [{"version": r["version"], "share": round(r["n"] / total * 100, 1)} for r in rows[:3]]
    rest = sum(r["n"] for r in rows[3:])
    if rest:
        top.append({"version": "قدیمی‌تر", "share": round(rest / total * 100, 1)})
    return (round(on_current / total * 100, 1) if latest else None), top


def install_charts(days: int = 90) -> dict:
    """Numbers for the clients «نمودارها» view: installs by version and platform, and new installs per day.

    An install is one device that has ever reported (a Client row); «active» means seen in the last
    30 days. Counting is done by the database per (os, version); the platform name comes from the os text.
    """
    now = timezone.now()
    latest = latest_stable_version()
    active_after = now - timedelta(days=30)
    online_after = now - timedelta(seconds=settings.CLIENT_OFFLINE_AFTER_SECONDS)

    groups = Client.objects.values("os", "version").annotate(
        n=Count("id"),
        active=Count("id", filter=Q(last_seen__gte=active_after)),
        online=Count("id", filter=Q(last_seen__gte=online_after)),
        new30=Count("id", filter=Q(first_seen__gte=active_after)),
        logged=Count("id", filter=Q(account__isnull=False)),
    )
    platforms: dict[str, dict] = {}
    versions: dict[str, dict] = {}
    for g in groups:
        plat = platform_of(g["os"]) or "نامشخص"
        p = platforms.setdefault(plat, dict.fromkeys(("installs", "active_30d", "online", "new_30d", "logged", "on_latest"), 0))
        p["installs"] += g["n"]
        p["active_30d"] += g["active"]
        p["online"] += g["online"]
        p["new_30d"] += g["new30"]
        p["logged"] += g["logged"]
        v = versions.setdefault(g["version"], {"installs": 0, "active_30d": 0, "platforms": {}, "platforms_active": {}})
        v["installs"] += g["n"]
        v["active_30d"] += g["active"]
        v["platforms"][plat] = v["platforms"].get(plat, 0) + g["n"]
        if g["active"]:
            v["platforms_active"][plat] = v["platforms_active"].get(plat, 0) + g["active"]
        if latest and g["version"] == latest:
            p["on_latest"] += g["active"]

    total = sum(p["installs"] for p in platforms.values())
    active = sum(p["active_30d"] for p in platforms.values())
    on_latest = sum(p["on_latest"] for p in platforms.values())

    # new installs per day in the panel's time zone, plus the running total
    tz = timezone.get_current_timezone()
    today = timezone.localdate()
    first_day = today - timedelta(days=days - 1)
    start = timezone.make_aware(datetime.combine(first_day, time.min))
    before = Client.objects.filter(first_seen__lt=start).count()
    per_day: dict = {}
    for row in (
        Client.objects.filter(first_seen__gte=start)
        .annotate(d=TruncDate("first_seen", tzinfo=tz))
        .values("d", "os")
        .annotate(n=Count("id"))
    ):
        day = per_day.setdefault(row["d"], {})
        plat = platform_of(row["os"]) or "نامشخص"
        day[plat] = day.get(plat, 0) + row["n"]
    series, running = [], before
    for i in range(days):
        d = first_day + timedelta(days=i)
        by_platform = per_day.get(d, {})
        new = sum(by_platform.values())
        running += new
        series.append({"date": d.isoformat(), "new": new, "total": running, "platforms": by_platform})

    return {
        "latest": latest,
        "totals": {
            "installs": total,
            "active_30d": active,
            "online": sum(p["online"] for p in platforms.values()),
            "new_30d": sum(p["new_30d"] for p in platforms.values()),
            "logged": sum(p["logged"] for p in platforms.values()),
            "on_latest": on_latest,
            "on_latest_share": round(on_latest / active * 100, 1) if latest and active else None,
        },
        "platforms": sorted(
            ({"platform": name, **vals, "share": round(vals["installs"] / total * 100, 1) if total else 0} for name, vals in platforms.items()),
            key=lambda x: -x["installs"],
        ),
        "versions": sorted(
            (
                {"version": name, **vals, "share": round(vals["installs"] / total * 100, 1) if total else 0,
                 "latest": bool(latest and name == latest), "old": version_old(name, latest)}
                for name, vals in versions.items()
            ),
            key=lambda x: -x["installs"],
        ),
        "daily": series,
    }
