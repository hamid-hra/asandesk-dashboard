"""محاسبه داده‌های تب «سرور و منابع» از روی نمونه‌های ذخیره‌شده."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection
from django.db.models import OuterRef, Subquery
from django.utils import timezone

from .models import MetricSample, Server


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


def bucket_series(rng: Range, now: datetime | None = None):
    """سری زمانی bucket‌شده برای همه سرورها.

    منابع (CPU/RAM/دیسک/شبکه) میانگین سرورها و کانکشن‌ها مجموع سرورهاست.
    bucket بدون داده مقدار None دارد تا نمودار در آن نقطه قطع شود.
    """
    now = now or timezone.now()
    end = floor_to_step(now, rng.step)
    start = end - (rng.points - 1) * rng.step
    sql = f"""
        SELECT date_bin(%s, ts, %s) AS b, server_id,
               avg(cpu), avg(ram), avg(disk), avg(net_pct), avg(tcp_established), max(tcp_established)
        FROM {MetricSample._meta.db_table}
        WHERE ts >= %s AND ts < %s
        GROUP BY b, server_id
    """
    with connection.cursor() as cur:
        cur.execute(sql, [rng.step, bin_origin(), start, end + rng.step])
        rows = cur.fetchall()

    agg: dict[datetime, list] = {}
    for b, _server_id, cpu, ram, disk, net, conn_avg, conn_max in rows:
        agg.setdefault(b, []).append((cpu, ram, disk, net, conn_avg, conn_max))

    points = []
    for i in range(rng.points):
        t = start + i * rng.step
        vals = agg.get(t)
        if not vals:
            points.append({"t": t.isoformat(), "cpu": None, "ram": None, "disk": None, "net": None,
                           "conn": None, "conn_max": None, "fail": None})
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
            # اتصال‌های ناموفق تا اتصال سرور آسان‌دسک منبع داده ندارد
            "fail": None,
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
    for server in Server.objects.all():
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


def live_snapshot():
    latest = latest_samples()
    servers = list(Server.objects.all())
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


def uptime_30d() -> float | None:
    """درصد دقیقه‌هایی از ۳۰ روز اخیر (یا از اولین گزارش) که دست‌کم یک گزارش داشته‌اند."""
    since = timezone.now() - timedelta(days=30)
    sql = f"""
        SELECT min(ts), count(DISTINCT (server_id, date_trunc('minute', ts)))
        FROM {MetricSample._meta.db_table} WHERE ts >= %s
    """
    with connection.cursor() as cur:
        cur.execute(sql, [since])
        first, minutes = cur.fetchone()
    if not first:
        return None
    servers = Server.objects.filter(last_seen__isnull=False).count() or 1
    span = max(1, int((timezone.now() - first).total_seconds() // 60) + 1)
    return round(min(100.0, minutes / (span * servers) * 100), 2)


def overview(range_id: str):
    rng = RANGES.get(range_id) or RANGES["7d"]
    return {
        "range": rng.id,
        "step_seconds": int(rng.step.total_seconds()),
        "points": bucket_series(rng),
        "servers": servers_table(),
        # تفکیک پلتفرم/منطقه و آمار نشست‌ها پس از اتصال سرور آسان‌دسک فعال می‌شود
        "breakdown": None,
        "sessions_total": None,
        "fail_rate": None,
    }
