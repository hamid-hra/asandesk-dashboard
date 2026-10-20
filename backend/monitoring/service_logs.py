"""لاگ کانتینرهای hbbs/hbbr سرورهای پایش‌شده: ذخیره از agent و خواندن برای «لاگ داکر» پنل."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

from .models import Server, ServiceLog

LOG_KEEP = 5000  # برای هر سرویس هر سرور
SINCE_UNITS = {"s": 1, "m": 60, "h": 3600}


def parse_ts(raw: str, fallback: datetime) -> datetime:
    """زمان داکر («2026-10-20T06:00:00.123456789Z»)؛ نانوثانیه کوتاه می‌شود."""
    text = (raw or "").strip()
    if not text:
        return fallback
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    head, dot, rest = text.partition(".")
    if dot:
        frac = "".join(ch for ch in rest if ch.isdigit())
        tz = rest[len(frac):]
        text = f"{head}.{frac[:6]}{tz}"
    try:
        ts = datetime.fromisoformat(text)
    except ValueError:
        return fallback
    return ts if ts.tzinfo else ts.replace(tzinfo=dt_timezone.utc)


def store(server: Server, services: dict) -> int:
    now = timezone.now()
    rows, sources = [], dict(server.log_sources or {})
    for name, item in services.items():
        sources[name] = {"container": item.get("container", ""), "error": item.get("error", ""), "at": now.isoformat()}
        for line in item.get("lines", []):
            rows.append(ServiceLog(server=server, service=name, ts=parse_ts(line["ts"], now), stream=line["stream"], text=line["text"]))
    ServiceLog.objects.bulk_create(rows, batch_size=500)
    server.log_sources = sources
    server.save(update_fields=["log_sources"])
    for name in services:
        cutoff = list(ServiceLog.objects.filter(server=server, service=name).order_by("-id").values_list("id", flat=True)[LOG_KEEP:LOG_KEEP + 1])
        if cutoff:
            ServiceLog.objects.filter(server=server, service=name, id__lte=cutoff[0]).delete()
    return len(rows)


def services_of(server: Server) -> list[dict]:
    """سرویس‌های یک سرور برای فهرست «لاگ داکر»، با وضعیت پروسه از گزارش منابع."""
    status = server.services or {}
    out = []
    for name, src in sorted((server.log_sources or {}).items()):
        up = (status.get(name) or {}).get("up")
        out.append({
            "service": name,
            "container": src.get("container") or name,
            "state": "running" if up else ("exited" if up is False else "unknown"),
            "status": src.get("error") or ("در حال اجرا" if up else "متوقف"),
        })
    return out


def _line(row: ServiceLog, with_service: bool) -> dict:
    out = {"ts": row.ts.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"), "stream": "err" if row.stream == "err" else "out", "text": row.text}
    if with_service:
        out["service"] = row.service
    return out


def read(server: Server, service: str, tail: int, since: str) -> dict:
    qs = ServiceLog.objects.filter(server=server)
    all_ = service == "all"
    if not all_:
        qs = qs.filter(service=service)
    if since:
        qs = qs.filter(ts__gte=timezone.now() - timedelta(seconds=int(since[:-1]) * SINCE_UNITS[since[-1]]))
    rows = list(qs.order_by("-id")[:tail])[::-1]
    if all_:
        rows.sort(key=lambda r: (r.ts, r.id))
    src = (server.log_sources or {}).get(service, {})
    up = ((server.services or {}).get(service) or {}).get("up")
    return {
        "service": service,
        "container": f"{server.name}" if all_ else f"{server.name} · {src.get('container') or service}",
        "state": "running" if all_ or up else "exited",
        "lines": [_line(r, all_) for r in rows],
        "error": "" if all_ else src.get("error", ""),
    }
