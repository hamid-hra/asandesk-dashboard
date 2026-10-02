"""API سرورهای HA: /api/settings/ha/ (بخش «ha»)."""

import re
import socket
from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from monitoring.models import Server as MonServer

from . import checker
from .models import HAConfig, HAEvent, HAServer

HOST_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.\-]{0,198}[A-Za-z0-9])?$")


def history(s: HAServer) -> list:
    """۲۴ نقطه (میانگین تأخیر هر ساعت در ۲۴ ساعت گذشته)؛ ساعت بدون داده None."""
    now = timezone.now()
    buckets = [[] for _ in range(24)]
    for ts, ms in s.checks.filter(ts__gte=now - timedelta(hours=24), ms__isnull=False).values_list("ts", "ms"):
        i = 23 - int((now - ts).total_seconds() // 3600)
        if 0 <= i < 24:
            buckets[i].append(ms)
    return [round(sum(b) / len(b)) if b else None for b in buckets]


def server_row(s: HAServer) -> dict:
    specs = checker.port_specs(s)
    return {
        "id": s.pk, "name": s.name, "address": s.address, "role": s.role, "priority": s.priority,
        "id_port": s.id_port, "relay_port": s.relay_port, "maintenance": s.maintenance,
        "status": "maintenance" if s.maintenance else s.status,
        "latency_ms": s.latency_ms, "serving": s.serving,
        "ports": [{"label": label, "ok": s.ports.get(label) if s.ports else None, "tip": checker.TIPS[key]} for key, label, *_ in specs],
        "key_state": checker.key_state(s),
        "last_check": s.last_check.isoformat() if s.last_check else None,
        "history": history(s),
        "agent_online": bool(s.monitor and s.monitor.online),
    }


def config_row(cfg: HAConfig) -> dict:
    return {"domain": cfg.domain, "method": cfg.method, "interval": cfg.interval, "fails": cfg.fails, "failback": cfg.failback}


def event_row(e: HAEvent) -> dict:
    return {"id": e.pk, "ts": e.ts.isoformat(), "kind": e.kind, "title": e.title, "by": e.by}


def resolve(domain: str) -> str:
    try:
        return socket.gethostbyname(domain)
    except OSError:
        return ""


def bad(field, msg):
    return Response({field: [msg]}, status=status.HTTP_400_BAD_REQUEST)


def install_command(request, token: str) -> str:
    url = request.build_absolute_uri("/api/agent/ingest")
    return (
        "git clone https://github.com/hamid-hra/asandesk-dashboard.git && "
        "docker build -t asandesk-agent asandesk-dashboard/agent && "
        "docker run -d --name asandesk-agent --restart unless-stopped --pid host "
        f"-e AGENT_URL={url} -e AGENT_TOKEN={token} "
        "-e AGENT_DISK_PATH=/hostfs -e AGENT_SYS=/hostsys -e AGENT_KEY_FILE=/keys/id_ed25519.pub "
        "-v /:/hostfs:ro -v /sys:/hostsys:ro "
        "-v /path/to/hbbs-data/id_ed25519.pub:/keys/id_ed25519.pub:ro asandesk-agent"
    )


class OverviewView(APIView):
    def get(self, request):
        cfg = HAConfig.get()
        servers = list(HAServer.objects.filter(draft=False).select_related("monitor"))
        rows = [server_row(s) for s in servers]
        serving = next((s for s in servers if s.serving), None)
        healthy = sum(1 for s in servers if s.status in ("ok", "slow") and not s.maintenance)
        events = [event_row(e) for e in HAEvent.objects.all()[:30]]
        last_fo = next((e for e in events if e["title"].startswith("failover")), None)
        return Response({
            "config": config_row(cfg), "servers": rows, "events": events,
            "serving": serving.name if serving else None, "healthy": healthy, "total": len(servers),
            "ip": resolve(cfg.domain), "last_failover": last_fo,
        })


class ConfigView(APIView):
    def patch(self, request):
        cfg = HAConfig.get()
        d = request.data
        if "method" in d:
            if d["method"] not in ("dns", "vip"):
                return bad("method", "روش نامعتبر است.")
            cfg.method = d["method"]
        for field, lo, hi, label in (("interval", 1, 60, "فاصلهٔ بررسی"), ("fails", 1, 10, "تعداد خطا")):
            if field in d:
                try:
                    v = int(d[field])
                except (TypeError, ValueError):
                    v = 0
                if not lo <= v <= hi:
                    return bad(field, f"{label} باید بین {lo} تا {hi} باشد.")
                setattr(cfg, field, v)
        if "failback" in d:
            cfg.failback = bool(d["failback"])
        if "domain" in d:
            dom = str(d["domain"]).strip()
            if not HOST_RE.match(dom):
                return bad("domain", "دامنه نامعتبر است.")
            cfg.domain = dom
        cfg.save()
        checker.event("edit", "تنظیمات failover تغییر کرد", request.user.username)
        return Response(config_row(cfg))


def validate_server(d, instance=None):
    """اعتبارسنجی فیلدهای سرور؛ خروجی (داده، پاسخ خطا)."""
    name = (d.get("name") or "").strip()
    address = (d.get("address") or "").strip()
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,62}$", name):
        return None, bad("name", "نام لاتین (حروف، عدد، - و _) وارد کنید.")
    if HAServer.objects.filter(name__iexact=name).exclude(pk=instance.pk if instance else None).exists():
        return None, bad("name", "این نام قبلاً استفاده شده است.")
    if not HOST_RE.match(address):
        return None, bad("address", "آدرس IP یا دامنهٔ معتبر وارد کنید.")
    ports = []
    for key, default in (("id_port", 21116), ("relay_port", 21117)):
        try:
            v = int(d.get(key) or default)
        except (TypeError, ValueError):
            v = 0
        if not 3 <= v <= 65533:
            return None, bad(key, "پورت نامعتبر است.")
        ports.append(v)
    return {"name": name, "address": address, "id_port": ports[0], "relay_port": ports[1]}, None


class ServerListView(APIView):
    def post(self, request):
        """مرحلهٔ ۱ دیالوگ افزودن: ساخت پیش‌نویس سرور + توکن agent."""
        data, err = validate_server(request.data)
        if err:
            return err
        role = request.data.get("role") if request.data.get("role") in ("primary", "backup") else "backup"
        if role == "primary" and HAServer.objects.filter(role="primary", draft=False).exists():
            return bad("role", "سرور اصلی از قبل وجود دارد؛ این سرور را «پشتیبان» بگیرید و بعد از افزودن، آن را اصلی کنید.")
        last = HAServer.objects.filter(draft=False).order_by("-priority").first()
        try:
            prio = int(request.data.get("priority") or 0)
        except (TypeError, ValueError):
            prio = 0
        prio = prio if 1 <= prio <= 99 else (last.priority + 1 if last else 1)
        with transaction.atomic():
            mon = MonServer(name=f"ha-{data['name']}", region="HA", ip=data["address"])
            token = mon.set_token()
            if MonServer.objects.filter(name=mon.name).exists():
                return bad("name", "برای این نام قبلاً agent ساخته شده است.")
            mon.save()
            s = HAServer.objects.create(role=role, priority=prio, draft=True, monitor=mon, **data)
        return Response({"server": server_row(s), "token": token, "command": install_command(request, token)}, status=status.HTTP_201_CREATED)


class ServerDetailView(APIView):
    def patch(self, request, pk):
        s = get_object_or_404(HAServer, pk=pk)
        d = request.data
        if any(k in d for k in ("name", "address", "id_port", "relay_port")):
            data, err = validate_server({**{"name": s.name, "address": s.address, "id_port": s.id_port, "relay_port": s.relay_port}, **d}, s)
            if err:
                return err
            for k, v in data.items():
                setattr(s, k, v)
        if "priority" in d:
            try:
                p = int(d["priority"])
            except (TypeError, ValueError):
                p = 0
            if not 1 <= p <= 99:
                return bad("priority", "اولویت باید بین ۱ تا ۹۹ باشد.")
            s.priority = p
        if "maintenance" in d and bool(d["maintenance"]) != s.maintenance:
            s.maintenance = bool(d["maintenance"])
            if s.maintenance:
                s.serving = False
            checker.event("edit", f"{s.name} " + ("از چرخه خارج شد (تعمیرات)" if s.maintenance else "دوباره وارد چرخه شد"), request.user.username)
        s.save()
        if "maintenance" in d:
            checker.pick_serving(HAConfig.get())
        return Response(server_row(HAServer.objects.get(pk=s.pk)))

    def delete(self, request, pk):
        s = get_object_or_404(HAServer, pk=pk)
        if not s.draft and s.role == "primary" and HAServer.objects.filter(draft=False).count() > 1:
            return Response({"detail": "ابتدا یکی از سرورهای پشتیبان را «اصلی» کنید، بعد این سرور را حذف کنید."}, status=status.HTTP_400_BAD_REQUEST)
        was_draft, name, mon = s.draft, s.name, s.monitor
        s.delete()
        if mon:
            mon.delete()
        if not was_draft:
            checker.event("edit", f"سرور {name} حذف شد", request.user.username)
            checker.pick_serving(HAConfig.get())
        return Response(status=status.HTTP_204_NO_CONTENT)


class ServerConfirmView(APIView):
    def post(self, request, pk):
        s = get_object_or_404(HAServer, pk=pk, draft=True)
        s.draft = False
        s.save(update_fields=["draft"])
        checker.event("add", f"سرور {s.name} با اولویت {s.priority} اضافه شد", request.user.username)
        try:
            checker.run_checks()
        except Exception:  # noqa: BLE001 — بررسی بعدی زمان‌بند جبران می‌کند
            pass
        return Response(server_row(HAServer.objects.get(pk=s.pk)))


class ServerTokenView(APIView):
    def post(self, request, pk):
        s = get_object_or_404(HAServer, pk=pk)
        if not s.monitor:
            s.monitor = MonServer.objects.create(name=f"ha-{s.name}", region="HA", ip=s.address, token_hash="x" * 64)
            s.save(update_fields=["monitor"])
        token = s.monitor.set_token()
        s.monitor.save()
        return Response({"token": token, "command": install_command(request, token)})


class ServerCheckView(APIView):
    """مرحلهٔ ۲ دیالوگ افزودن: چک‌لیست اتصال با نتیجهٔ واقعی."""

    def post(self, request, pk):
        s = get_object_or_404(HAServer, pk=pk)
        r = checker.probe_server(s)
        p = r["ports"]
        id_label, relay_label = f"{s.id_port} TCP", str(s.relay_port)
        udp_label = f"{s.id_port} UDP"
        ks = checker.key_state(s)
        online = bool(s.monitor and s.monitor.online)
        net_ok = any(p.values())
        checks = [
            {"id": "net", "label": "دسترسی شبکه", "critical": True, "ok": net_ok,
             "detail": f"پینگ {r['latency']}ms" if r["latency"] else ("پاسخ داد" if net_ok else "پاسخی نیامد"),
             "help": "" if net_ok else "سرور از پنل در دسترس نیست. آدرس را بررسی کنید و مطمئن شوید سرور روشن است و فایروال پورت‌ها را بسته نگه نداشته."},
            {"id": "p16", "label": f"پورت {s.id_port} TCP/UDP", "critical": True, "ok": bool(p.get(id_label) and p.get(udp_label)),
             "detail": f"TCP {'✓' if p.get(id_label) else '✗'} · UDP {'✓' if p.get(udp_label) else '✗'}",
             "help": "" if p.get(id_label) and p.get(udp_label) else f"پورت {s.id_port} را برای هر دو پروتکل TCP و UDP در فایروال سرور باز کنید و از اجرا بودن hbbs مطمئن شوید."},
            {"id": "p17", "label": f"پورت {s.relay_port} (رله)", "critical": True, "ok": bool(p.get(relay_label)),
             "detail": "باز" if p.get(relay_label) else "بسته",
             "help": "" if p.get(relay_label) else f"پورت {s.relay_port} را در فایروال باز کنید و از اجرا بودن hbbr مطمئن شوید."},
            {"id": "key", "label": "تطابق کلید عمومی", "critical": ks == "bad", "ok": True if ks == "ok" else (False if ks == "bad" else None),
             "detail": {"ok": "یکسان با سرور اصلی", "bad": "با سرور اصلی یکی نیست", "unknown": "نامشخص (agent کلید را گزارش نکرده)"}[ks],
             "help": "فایل‌های id_ed25519 و id_ed25519.pub سرور اصلی را روی این سرور کپی کنید و hbbs را دوباره راه‌اندازی کنید." if ks == "bad" else
                     ("برای سنجش خودکار، agent را با گزینهٔ AGENT_KEY_FILE اجرا کنید (دستور مرحلهٔ قبل)." if ks == "unknown" else "")},
            {"id": "agent", "label": "ارتباط agent", "critical": False, "ok": online,
             "detail": f"متصل · v{s.monitor.agent_version}" if online and s.monitor.agent_version else ("متصل" if online else "گزارشی نرسیده"),
             "help": "" if online else "دستور نصب مرحلهٔ قبل را روی سرور اجرا کنید. بدون agent هم می‌توان سرور را اضافه کرد، اما آمار منابع و سنجش کلید نمایش داده نمی‌شود."},
        ]
        return Response({"target": f"{s.address}:{s.id_port}", "checks": checks})


class ServerPromoteView(APIView):
    """اصلی‌کردن یک سرور؛ سرور اصلی قبلی پشتیبان می‌شود و اولویت‌ها جابه‌جا می‌شوند."""

    def post(self, request, pk):
        s = get_object_or_404(HAServer, pk=pk, draft=False)
        if s.role == "primary":
            return Response({"detail": "این سرور همین حالا اصلی است."}, status=status.HTTP_409_CONFLICT)
        with transaction.atomic():
            old = HAServer.objects.filter(role="primary", draft=False).first()
            if old:
                old.role, old.priority, s.priority = "backup", s.priority, old.priority
                old.save(update_fields=["role", "priority"])
            s.role = "primary"
            s.save(update_fields=["role", "priority"])
        checker.event("edit", f"{s.name} به‌عنوان سرور اصلی تعیین شد", request.user.username)
        checker.pick_serving(HAConfig.get())
        return Response(server_row(HAServer.objects.get(pk=s.pk)))
