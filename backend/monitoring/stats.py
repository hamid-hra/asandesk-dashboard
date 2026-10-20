"""محاسبه داده‌های تب «سرور و منابع» از روی نمونه‌های ذخیره‌شده."""

import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection
from django.db.models import Count, OuterRef, Q, Subquery
from django.utils import timezone

from clients.models import ConnSession
from clients.stats import online_breakdown

from .agent_commands import ONLINE_COMMAND
from .models import MetricSample, Server, monitored_servers


@dataclass(frozen=True)
class Range:
    id: str
    points: int
    step: timedelta


# همان تعداد نقطه و گام طرح
RANGES = {
    "24h": Range("24h", 25, timedelta(hours=1)),
    "7d": Range("7d", 29, timedelta(hours=6)),
    "30d": Range("30d", 31, timedelta(days=1)),
    "90d": Range("90d", 46, timedelta(days=2)),
}


def bin_origin() -> datetime:
    # مرز bucketها روی نیمه‌شب به وقت محلی (Asia/Tehran) قرار می‌گیرد
    return datetime(2000, 1, 1, tzinfo=ZoneInfo(settings.TIME_ZONE))


def floor_to_step(ts: datetime, step: timedelta) -> datetime:
    origin = bin_origin()
    return origin + ((ts - origin) // step) * step


def range_start(rng: Range, now: datetime) -> datetime:
    """آغاز اولین bucket نمودار؛ KPIها هم از همین‌جا می‌شمارند تا با نمودار هم‌بازه باشند."""
    return floor_to_step(now, rng.step) - (rng.points - 1) * rng.step


def today_start(now: datetime) -> datetime:
    return timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)


# درخواستی که هنوز احراز نشده و تازه شروع شده، «در انتظار» است (کاربر در حال وارد کردن رمز)؛ نه ناموفق
PENDING_FOR = timedelta(minutes=2)


def request_counts(since: datetime, now: datetime | None = None) -> dict:
    """درخواست‌های اتصالی که به دستگاه کنترل‌شونده رسیده و از آغاز `since` گزارش شده‌اند.

    موفق = احراز هویت شده. بقیه یا هنوز در انتظارند، یا تمام شده‌اند: «ناموفق» و «لغو شده» فقط وقتی جدا
    می‌شوند که اپ علت را در گزارش close فرستاده باشد (ConnSession.result)؛ وگرنه «نامشخص» می‌مانند.
    درخواستی که هرگز به دستگاه نرسیده (مثلاً قطع شدن پیش از رسیدن به آن) در این آمار نیست.
    """
    now = now or timezone.now()
    unauth = Q(authorized_at__isnull=True)
    pending = unauth & Q(ended_at__isnull=True, started_at__gte=now - PENDING_FOR)
    done = unauth & ~pending
    agg = ConnSession.objects.filter(started_at__gte=since).aggregate(
        total=Count("id"),
        ok=Count("id", filter=Q(authorized_at__isnull=False)),
        pending=Count("id", filter=pending),
        failed=Count("id", filter=done & Q(result="failed")),
        cancelled=Count("id", filter=done & Q(result="cancelled")),
        unknown=Count("id", filter=done & ~Q(result__in=["failed", "cancelled"])),
    )
    bad = agg["failed"] + agg["cancelled"] + agg["unknown"]
    finished = agg["total"] - agg["pending"]
    return {**agg, "fail_rate": round(bad / finished * 100, 2) if finished else None}


def request_series(rng: Range, start: datetime, end: datetime, now: datetime) -> dict[datetime, tuple[int, int]]:
    """{آغاز bucket: (کل درخواست‌ها، ناموفق یا لغو شده)}"""
    sql = f"""
        SELECT date_bin(%s, started_at, %s) AS b, count(*),
               count(*) FILTER (WHERE authorized_at IS NULL AND NOT (ended_at IS NULL AND started_at >= %s))
        FROM {ConnSession._meta.db_table}
        WHERE started_at >= %s AND started_at < %s
        GROUP BY b
    """
    with connection.cursor() as cur:
        cur.execute(sql, [rng.step, bin_origin(), now - PENDING_FOR, start, end + rng.step])
        return {b: (n, bad) for b, n, bad in cur.fetchall()}


def bucket_series(rng: Range, now: datetime | None = None, server_ids: list[int] | None = None):
    """سری زمانی bucket‌شده برای سرورهای پایش‌شده (یا فقط `server_ids`).

    منابع (CPU/RAM/دیسک/شبکه) میانگین سرورها و کانکشن‌ها مجموع سرورهاست.
    bucket بدون داده مقدار None دارد تا نمودار در آن نقطه قطع شود.
    """
    now = now or timezone.now()
    end = floor_to_step(now, rng.step)
    start = range_start(rng, now)
    reqs = request_series(rng, start, end, now)
    sql = f"""
        SELECT date_bin(%s, ts, %s) AS b, server_id,
               avg(cpu), avg(ram), avg(disk), avg(net_pct), avg(tcp_established), max(tcp_established)
        FROM {MetricSample._meta.db_table}
        WHERE ts >= %s AND ts < %s AND server_id = ANY(%s)
        GROUP BY b, server_id
    """
    ids = server_ids if server_ids is not None else list(monitored_servers().values_list("pk", flat=True))
    with connection.cursor() as cur:
        cur.execute(sql, [rng.step, bin_origin(), start, end + rng.step, ids])
        rows = cur.fetchall()

    agg: dict[datetime, list] = {}
    for b, _server_id, cpu, ram, disk, net, conn_avg, conn_max in rows:
        agg.setdefault(b, []).append((cpu, ram, disk, net, conn_avg, conn_max))

    points = []
    for i in range(rng.points):
        t = start + i * rng.step
        vals = agg.get(t)
        # درخواست‌ها از نشست‌های گزارش‌شدهٔ کلاینت‌ها می‌آیند و به agent سرور وابسته نیستند؛ بدون درخواست = ۰
        req, fail = reqs.get(t, (0, 0))
        if not vals:
            points.append({"t": t.isoformat(), "cpu": None, "ram": None, "disk": None, "net": None,
                           "conn": None, "conn_max": None, "req": req, "fail": fail})
            continue
        n = len(vals)
        points.append({
            "t": t.isoformat(),
            "cpu": round(sum(v[0] for v in vals) / n, 2),
            "ram": round(sum(v[1] for v in vals) / n, 2),
            "disk": round(sum(v[2] for v in vals) / n, 2),
            "net": round(sum(v[3] for v in vals) / n, 2),
            "conn": round(sum(v[4] for v in vals), 1),
            "conn_max": sum(v[5] for v in vals),
            "req": req,
            "fail": fail,
        })
    return points


def latest_samples() -> dict[int, MetricSample]:
    ids = MetricSample.objects.filter(server=OuterRef("pk")).order_by("-ts").values("pk")[:1]
    latest_ids = Server.objects.annotate(latest=Subquery(ids)).values_list("latest", flat=True)
    samples = MetricSample.objects.filter(pk__in=[x for x in latest_ids if x])
    return {s.server_id: s for s in samples}


def server_status(server: Server, sample: MetricSample | None) -> str:
    if server.maintenance:
        return "maint"
    if not server.online or sample is None:
        return "offline"
    if sample.cpu >= 80 or sample.ram >= 90:
        return "high"
    return "ok"


def servers_table():
    latest = latest_samples()
    out = []
    for server in reporting_servers():
        s = latest.get(server.pk)
        out.append({
            "id": server.pk,
            "name": server.name,
            "region": server.region,
            "ip": server.ip,
            "status": server_status(server, s),
            "online": server.online,
            "cpu": round(s.cpu, 1) if s else None,
            "ram": round(s.ram, 1) if s else None,
            "conns": s.tcp_established if s else None,
            "latency_ms": round(s.latency_ms, 1) if s and s.latency_ms is not None else None,
            "last_seen": server.last_seen.isoformat() if server.last_seen else None,
        })
    return out


def reporting_servers(server_id: int | None = None):
    """سرورهای پایش‌شده (HA با agent فعال)؛ با `server_id` فقط همان یکی. سرور بدون agent حساب نمی‌شود."""
    qs = monitored_servers()
    return qs.filter(pk=server_id) if server_id else qs


def live_snapshot(server_id: int | None = None):
    latest = latest_samples()
    servers = list(reporting_servers(server_id))
    online = [srv for srv in servers if srv.online and srv.pk in latest]
    samples = [latest[srv.pk] for srv in online]
    agg = None
    if samples:
        n = len(samples)
        ram_total = sum(srv.ram_total for srv in online)
        disk_total = sum(srv.disk_total for srv in online)
        cap = sum(srv.net_capacity_bps for srv in online)
        net_bps = sum(s.net_rx_bps + s.net_tx_bps for s in samples)
        lat = [s.latency_ms for s in samples if s.latency_ms is not None]
        agg = {
            "ts": max(s.ts for s in samples).isoformat(),
            "cpu": round(sum(s.cpu for s in samples) / n, 1),
            "cores": sum(srv.cores for srv in online),
            "ram": round(sum(s.ram_used for s in samples) / ram_total * 100, 1) if ram_total else None,
            "ram_used": sum(s.ram_used for s in samples),
            "ram_total": ram_total,
            "disk": round(sum(s.disk_used for s in samples) / disk_total * 100, 1) if disk_total else None,
            "disk_used": sum(s.disk_used for s in samples),
            "disk_total": disk_total,
            "net_bps": net_bps,
            "net_rx_bps": sum(s.net_rx_bps for s in samples),
            "net_tx_bps": sum(s.net_tx_bps for s in samples),
            "net_capacity_bps": cap,
            "net": round(net_bps / cap * 100, 2) if cap else round(sum(s.net_pct for s in samples) / n, 2),
            "tcp_established": sum(s.tcp_established for s in samples),
            "latency_ms": round(sum(lat) / len(lat), 1) if lat else None,
            "load1": round(sum(s.load1 for s in samples), 2),
        }
    return {"online": len(online), "total": len(servers), "aggregate": agg}


_uptime_cache: dict = {"at": 0.0, "value": None}
UPTIME_CACHE_SECONDS = 60


def uptime_30d() -> float | None:
    """آپتایم ۳۰ روز؛ سایدبار هر کاربر مدام می‌پرسد و شمارش ۳۰ روز نمونه گران است، پس یک دقیقه در حافظه می‌ماند."""
    now = time.monotonic()
    if _uptime_cache["at"] and now - _uptime_cache["at"] < UPTIME_CACHE_SECONDS:
        return _uptime_cache["value"]
    value = _uptime_30d()
    _uptime_cache.update(at=now, value=value)
    return value


def _uptime_30d() -> float | None:
    """درصد دقیقه‌هایی از ۳۰ روز اخیر (یا از اولین گزارش) که دست‌کم یک گزارش داشته‌اند."""
    since = timezone.now() - timedelta(days=30)
    sql = f"""
        SELECT min(ts), count(DISTINCT (server_id, date_trunc('minute', ts)))
        FROM {MetricSample._meta.db_table} WHERE ts >= %s AND server_id = ANY(%s)
    """
    with connection.cursor() as cur:
        cur.execute(sql, [since, list(monitored_servers().values_list("pk", flat=True))])
        first, minutes = cur.fetchone()
    if not first:
        return None
    servers = monitored_servers().count() or 1
    span = max(1, int((timezone.now() - first).total_seconds() // 60) + 1)
    return round(min(100.0, minutes / (span * servers) * 100), 2)


def overview(range_id: str, server_id: int | None = None):
    """`server_id`: فقط منابع همین سرور؛ بدون آن میانگین/مجموع همهٔ سرورهای پایش‌شده. جدول سرورها همیشه همه را دارد."""
    rng = RANGES.get(range_id) or RANGES["7d"]
    chosen = [s.pk for s in reporting_servers(server_id)] if server_id else None
    now = timezone.now()
    in_range = request_counts(range_start(rng, now), now)
    return {
        "range": rng.id,
        "step_seconds": int(rng.step.total_seconds()),
        "server": server_id if server_id and chosen else None,
        "points": bucket_series(rng, now, chosen),
        "servers": servers_table(),
        # دستگاه‌های آنلاین الان به تفکیک پلتفرم
        "breakdown": {**online_breakdown(), "online_command": ONLINE_COMMAND},
        # نشست‌های موفقی که کلاینت‌ها در بازه گزارش داده‌اند (audit/conn)
        "sessions_total": in_range["ok"],
        "fail_rate": in_range["fail_rate"],
        "requests": {"today": request_counts(today_start(now), now), "range": in_range},
    }
