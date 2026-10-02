"""بررسی سلامت سرورهای شناسه/رله (hbbs/hbbr) و انتخاب سرور فعال.

برای هر سرور پورت‌های TCP و UDP 21116 واقعاً آزمایش می‌شوند (UDP با یک RegisterPeer مثل
خود کلاینت). پنل فقط وضعیت و «سرور فعال» را تعیین و ثبت می‌کند؛ جابه‌جایی واقعی ترافیک
(DNS یا IP شناور) روی خود سرورها/DNS انجام می‌شود.
"""

import socket
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.utils import timezone

from .models import HACheck, HAConfig, HAEvent, HAServer

SLOW_MS = 100
TIMEOUT = 2.0
# پروب UDP: RendezvousMessage{register_peer: RegisterPeer{id: "hcprobe01"}}؛ سرور با RegisterPeerResponse جواب می‌دهد
UDP_PROBE = b"\x32\x0b\x0a\x09hcprobe01"

TIPS = {
    "id-1": "NAT type test", "id/tcp": "ID / hole punching", "id/udp": "ID / heartbeat",
    "relay": "Relay", "web-id": "Web client (ID)", "web-relay": "Web client (Relay)",
}


def port_specs(s: HAServer):
    """(کلید، برچسب، پورت، پروتکل، حیاتی؟) — شش پورت استاندارد hbbs/hbbr."""
    i, r = s.id_port, s.relay_port
    return [
        ("id-1", str(i - 1), i - 1, "tcp", False),
        ("id/tcp", f"{i} TCP", i, "tcp", True),
        ("id/udp", f"{i} UDP", i, "udp", False),
        ("relay", str(r), r, "tcp", True),
        ("web-id", str(i + 2), i + 2, "tcp", False),
        ("web-relay", str(r + 2), r + 2, "tcp", False),
    ]


def probe_tcp(host: str, port: int) -> int | None:
    t = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=TIMEOUT):
            return max(1, int((time.monotonic() - t) * 1000))
    except OSError:
        return None


def probe_udp(host: str, port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(TIMEOUT)
            s.sendto(UDP_PROBE, (host, port))
            s.recvfrom(2048)
            return True
    except OSError:
        return False


def probe_server(s: HAServer) -> dict:
    """نتیجهٔ بررسی: {ports: {برچسب: bool}, latency, status}"""
    specs = port_specs(s)
    with ThreadPoolExecutor(max_workers=len(specs)) as ex:
        futs = {key: ex.submit(probe_tcp if proto == "tcp" else probe_udp, s.address, port) for key, _l, port, proto, _c in specs}
        res = {k: f.result() for k, f in futs.items()}
    ports, crit_fail, any_fail = {}, False, False
    for key, label, _p, proto, critical in specs:
        ok = res[key] is not None and res[key] is not False
        ports[label] = ok
        if not ok:
            any_fail = True
            crit_fail = crit_fail or critical
    latency = res["id/tcp"] if isinstance(res["id/tcp"], int) else None
    if crit_fail:
        status = "down"
    elif any_fail or (latency is not None and latency >= SLOW_MS):
        status = "slow"
    else:
        status = "ok"
    return {"ports": ports, "latency": latency, "status": status}


def key_state(s: HAServer) -> str:
    """ok | bad | unknown — مقایسهٔ اثرانگشت کلید گزارش‌شده با agent سرور اصلی."""
    mine = s.monitor.pubkey_fp if s.monitor_id else ""
    primary = HAServer.objects.filter(role=HAServer.Role.PRIMARY, draft=False).select_related("monitor").first()
    ref = primary.monitor.pubkey_fp if primary and primary.monitor_id else ""
    if not mine or not ref:
        return "unknown"
    return "ok" if mine == ref else "bad"


def event(kind: str, title: str, by: str = "system"):
    HAEvent.objects.create(kind=kind, title=title, by=by)


def apply_result(s: HAServer, r: dict, cfg: HAConfig) -> None:
    prev = s.status
    s.ports, s.latency_ms, s.last_check = r["ports"], r["latency"], timezone.now()
    # شکست تازه فقط بعد از چند بررسی ناموفق پشت‌سرهم «قطع» حساب می‌شود
    if r["status"] == "down":
        s.fail_count += 1
        new = "down" if s.fail_count >= cfg.fails else (prev if prev in ("ok", "slow") else "down")
    else:
        s.fail_count, new = 0, r["status"]
    s.status = new
    s.save(update_fields=["ports", "latency_ms", "last_check", "fail_count", "status"])
    HACheck.objects.create(server=s, ms=r["latency"], ok=r["status"] != "down")
    if new != prev and prev != "unknown":
        if new == "down":
            event("err", f"{s.name} پاسخ نداد (پورت‌های حیاتی بسته است)")
        elif new == "slow":
            event("warn", f"{s.name} کند شد" + (f" (تأخیر {r['latency']}ms)" if r["latency"] else "") + " یا بخشی از پورت‌ها پاسخ نمی‌دهد")
        elif new == "ok" and prev == "down":
            event("ok", f"{s.name} دوباره سالم شد")


def pick_serving(cfg: HAConfig) -> None:
    """سرور فعال: سالم‌ترین با کمترین اولویت. اگر برگشت خودکار خاموش باشد، سرور فعال فعلی تا وقتی سالم است می‌ماند."""
    servers = list(HAServer.objects.filter(draft=False, maintenance=False))
    healthy = [s for s in servers if s.status in ("ok", "slow")]
    current = next((s for s in HAServer.objects.filter(draft=False, serving=True)), None)
    target = None
    if current and current in healthy and not cfg.failback:
        target = current
    elif healthy:
        target = min(healthy, key=lambda s: (s.priority, s.pk))
    if target is None or (current and current.pk == target.pk):
        return
    HAServer.objects.filter(serving=True).update(serving=False)
    HAServer.objects.filter(pk=target.pk).update(serving=True)
    if current:
        event("err" if current.status == "down" else "warn", f"failover: سرور فعال از {current.name} به {target.name} تغییر کرد")
    else:
        event("ok", f"{target.name} به‌عنوان سرور فعال انتخاب شد")


def run_checks() -> int:
    cfg = HAConfig.get()
    servers = list(HAServer.objects.filter(draft=False, maintenance=False).select_related("monitor"))
    if servers:
        with ThreadPoolExecutor(max_workers=min(8, len(servers))) as ex:
            results = list(ex.map(probe_server, servers))
        for s, r in zip(servers, results):
            apply_result(s, r, cfg)
    pick_serving(cfg)
    return len(servers)


def prune():
    HACheck.objects.filter(ts__lt=timezone.now() - timedelta(hours=48)).delete()
    HAEvent.objects.filter(ts__lt=timezone.now() - timedelta(days=180)).delete()
