"""Settings → panel update and docker logs. Owner only: these reach the host's Docker."""

import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsOwner
from activity.service import record
from backups.models import Operation
from config.version import VERSION

from monitoring import service_logs
from monitoring.models import monitored_servers

from . import control
from .control import ControlError

SERVICE_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
SINCE_RE = re.compile(r"^\d{1,4}[smh]$")  # مثل 10m یا 2h
MAX_NEW_ENTRIES = 10


def entries_after(changelog: list[dict], current: str) -> list[dict]:
    """The changelog entries newer than the running version (the list is newest first)."""
    out = []
    for entry in changelog:
        if entry.get("version") == current:
            break
        out.append(entry)
    return out[:MAX_NEW_ENTRIES]


def shape(raw: dict) -> dict:
    """What the panel shows: running version, the last check against GitHub, and the update job."""
    out = {"version": VERSION, "control": {"online": True}, "job": raw.get("job"), "check": None, "check_error": raw.get("check_error") or ""}
    check = raw.get("check")
    if check:
        changelog = check.get("remote_changelog") or []
        disk = check.get("disk_version") or ""
        behind = int(check.get("behind") or 0)
        pending = bool(disk and disk != VERSION)  # کد جدید pull شده ولی هنوز بیلد نشده
        out["check"] = {
            "checked_at": check.get("checked_at"),
            "branch": check.get("branch"),
            "behind": behind,
            "ahead": int(check.get("ahead") or 0),
            "dirty": bool(check.get("dirty")),
            "commits": check.get("commits") or [],
            "remote_version": changelog[0]["version"] if changelog else None,
            "disk_version": disk or None,
            "pending_build": pending,
            "available": behind > 0 or pending,
            "new_entries": entries_after(changelog, VERSION),
        }
    return out


def offline(e: ControlError) -> Response:
    """The panel keeps working without `control`; only these pages say so."""
    return Response({"version": VERSION, "control": {"online": False, "error": e.message}, "job": None, "check": None, "check_error": ""})


class OwnerView(APIView):
    permission_classes = [IsOwner]


class UpdateStatusView(OwnerView):
    def get(self, request):
        try:
            return Response(shape(control.call("GET", "/update/status")))
        except ControlError as e:
            return offline(e) if e.offline else Response({"detail": e.message}, status=e.status)


class UpdateCheckView(OwnerView):
    """Fetch from GitHub now and compare (a few seconds)."""

    def post(self, request):
        try:
            return Response(shape(control.call("POST", "/update/check", timeout=55)))
        except ControlError as e:
            return offline(e) if e.offline else Response({"detail": e.message}, status=e.status)


class UpdateStartView(OwnerView):
    """git pull + docker compose up -d --build, in a separate container that survives the restart."""

    def post(self, request):
        if Operation.objects.filter(status__in=[Operation.Status.QUEUED, Operation.Status.RUNNING]).exists():
            return Response({"detail": "یک پشتیبان‌گیری یا بازگردانی در جریان است؛ بعد از پایانش به‌روزرسانی کنید."}, status=status.HTTP_409_CONFLICT)
        try:
            before = shape(control.call("GET", "/update/status"))
            control.call("POST", "/update/start")
            raw = control.call("GET", "/update/status")
        except ControlError as e:
            return Response({"detail": e.message}, status=e.status)
        target = (before["check"] or {}).get("remote_version") or "آخرین نسخه"
        record("system.update", f"به‌روزرسانی پنل را شروع کرد ({VERSION} ← {target})", request=request)
        return Response(shape(raw), status=status.HTTP_202_ACCEPTED)


def agent_shape(raw: dict) -> dict:
    """Agents (Asan-desk-agent started with docker compose) on the panel's own server, and the agent update job."""
    agents = []
    for a in raw.get("agents", []):
        check = a.get("check") or {}
        behind = int(check.get("behind") or 0)
        disk, remote = check.get("disk_version") or "", check.get("remote_version") or ""
        agents.append({
            "project": a.get("project"),
            "container": a.get("name"),
            "state": a.get("state"),
            "checked_at": check.get("checked_at"),
            "branch": check.get("branch"),
            "behind": behind,
            "dirty": bool(check.get("dirty")),
            "disk_version": disk or None,
            "remote_version": remote or None,
            "commits": check.get("commits") or [],
            "available": bool(check) and (behind > 0 or bool(disk and remote and disk != remote)),
            "error": a.get("error") or "",
        })
    return {"control": {"online": True}, "agents": agents, "job": raw.get("job")}


class AgentsStatusView(OwnerView):
    def get(self, request):
        try:
            return Response(agent_shape(control.call("GET", "/agents")))
        except ControlError as e:
            return Response({"control": {"online": False, "error": e.message}, "agents": [], "job": None}) if e.offline else Response({"detail": e.message}, status=e.status)


class AgentsCheckView(OwnerView):
    """Fetch every agent's repository from GitHub now (a few seconds each)."""

    def post(self, request):
        try:
            return Response(agent_shape(control.call("POST", "/agents/check", timeout=120)))
        except ControlError as e:
            return Response({"detail": e.message}, status=e.status)


class AgentsStartView(OwnerView):
    """git pull + docker compose up -d --build in the agent's own folder (the agent restarts for a few seconds)."""

    def post(self, request):
        project = str(request.data.get("project", ""))
        if not SERVICE_RE.match(project):
            return Response({"project": ["پروژهٔ نامعتبر است."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            raw = control.call("POST", "/agents/update", params={"project": project})
        except ControlError as e:
            return Response({"detail": e.message}, status=e.status)
        record("system.agent_update", f"به‌روزرسانی ایجنت ({project}) را شروع کرد", request=request)
        return Response(agent_shape(raw), status=status.HTTP_202_ACCEPTED)


def web_running() -> dict | None:
    """The web client version the `web` container serves now (its /version.json), or None if it is not up."""
    try:
        with urllib.request.urlopen(settings.WEB_APP_URL.rstrip("/") + "/version.json", timeout=3) as resp:
            data = json.loads(resp.read(4096).decode("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not data.get("version"):
        return None
    return {"version": str(data["version"])[:32], "built_at": str(data.get("built_at") or "")[:40]}


def web_shape(raw: dict) -> dict:
    """The AsanDesk web client (`web` + `webgw`): running version, last check and its own update job."""
    running = web_running()
    out = {"control": {"online": True}, "running": running, "job": raw.get("job"), "check": None, "check_error": raw.get("check_error") or ""}
    check = raw.get("check")
    if check:
        changelog = check.get("remote_changelog") or []
        disk = check.get("disk_version") or ""
        remote = check.get("remote_version") or ""
        current = (running or {}).get("version") or disk
        commits = check.get("commits") or []
        panel_files = check.get("panel_files") or []
        pending = bool(running and disk and disk != running["version"])  # کد روی سرور جدیدتر از کلاینت در حال اجرا
        out["check"] = {
            "checked_at": check.get("checked_at"),
            "branch": check.get("branch"),
            "dirty": bool(check.get("dirty")),
            "commits": commits,
            "disk_version": disk or None,
            "remote_version": remote or None,
            "pending_build": pending,
            # تغییرات پنل هم در راه است: کلاینت وب جدا به‌روز نمی‌شود، به‌روزرسانی پنل هر دو را می‌سازد
            "panel_files": panel_files,
            "needs_panel": bool(panel_files) and bool(commits or (remote and remote != current)),
            "available": bool(commits) or bool(remote and remote != current) or pending,
            "new_entries": entries_after(changelog, current),
        }
    return out


def web_offline(e: ControlError) -> Response:
    return Response({"control": {"online": False, "error": e.message}, "running": web_running(), "job": None, "check": None, "check_error": ""})


class WebUpdateStatusView(OwnerView):
    def get(self, request):
        try:
            return Response(web_shape(control.call("GET", "/web/status")))
        except ControlError as e:
            return web_offline(e) if e.offline else Response({"detail": e.message}, status=e.status)


class WebUpdateCheckView(OwnerView):
    """Fetch from GitHub now and see what is new for the web client."""

    def post(self, request):
        try:
            return Response(web_shape(control.call("POST", "/web/check", timeout=55)))
        except ControlError as e:
            return web_offline(e) if e.offline else Response({"detail": e.message}, status=e.status)


class WebUpdateStartView(OwnerView):
    """git pull + rebuild of only `web` and `webgw` (refused by control when the new commits touch the panel)."""

    def post(self, request):
        try:
            before = web_shape(control.call("GET", "/web/status"))
            control.call("POST", "/web/update")
            raw = control.call("GET", "/web/status")
        except ControlError as e:
            return Response({"detail": e.message}, status=e.status)
        running = (before.get("running") or {}).get("version") or "?"
        target = (before["check"] or {}).get("remote_version") or "آخرین نسخه"
        record("system.web_update", f"به‌روزرسانی کلاینت وب را شروع کرد ({running} ← {target})", request=request)
        return Response(web_shape(raw), status=status.HTTP_202_ACCEPTED)


def remote_server(request):
    """?server=<شناسهٔ سرور پایش‌شده> برای لاگ سرویس‌های آن سرور (از agent)؛ None = سرویس‌های خود پنل (control)."""
    raw = request.query_params.get("server", "")
    if not raw:
        return None, None
    try:
        server = monitored_servers().filter(pk=int(raw)).first()
    except ValueError:
        server = None
    if server is None:
        return None, Response({"server": ["چنین سروری پیدا نشد."]}, status=status.HTTP_404_NOT_FOUND)
    return server, None


class LogSourcesView(OwnerView):
    """منبع‌های «لاگ داکر»: خود پنل و هر سرور پایش‌شده‌ای که agent لاگ سرویس‌هایش را می‌فرستد."""

    def get(self, request):
        servers = [
            {"id": s.pk, "name": s.name, "online": s.online, "services": service_logs.services_of(s)}
            for s in monitored_servers().order_by("name")
        ]
        return Response({"sources": [{"id": None, "name": "پنل (همین سرور)", "online": True, "services": []}, *servers]})


class ServicesView(OwnerView):
    def get(self, request):
        server, bad = remote_server(request)
        if bad:
            return bad
        if server is not None:
            return Response({"services": service_logs.services_of(server)})
        try:
            return Response(control.call("GET", "/services"))
        except ControlError as e:
            return Response({"detail": e.message, "offline": e.offline}, status=status.HTTP_503_SERVICE_UNAVAILABLE if e.offline else e.status)


ALL = "all"
ALL_MAX_LINES = 3000


def merged_logs(tail: int, since: str) -> dict:
    """Every service's log in one time-ordered list; each line carries its service name.

    Asks `control` for each service in parallel (the old control service only knows single services).
    """
    services = [x for x in control.call("GET", "/services").get("services", []) if x.get("service") != "update-job"]

    def one(svc: dict):
        try:
            return svc, control.call("GET", "/logs", params={"service": svc["service"], "tail": tail, "since": since}, timeout=40), ""
        except ControlError as e:
            return svc, None, e.message

    lines, failed = [], []
    with ThreadPoolExecutor(max_workers=min(8, len(services) or 1)) as pool:
        for svc, data, err in pool.map(one, services):
            if data is None:
                failed.append(f"{svc['service']}: {err}")
                continue
            lines.extend({**line, "service": svc["service"]} for line in data.get("lines", []))
    lines.sort(key=lambda line: line.get("ts") or "")
    return {"service": ALL, "container": f"{len(services)} سرویس", "state": "running", "lines": lines[-ALL_MAX_LINES:], "failed": failed}


class LogsView(OwnerView):
    def get(self, request):
        service = request.query_params.get("service", "")
        if service != ALL and not SERVICE_RE.match(service):
            return Response({"service": ["سرویس نامعتبر است."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            tail = max(10, min(int(request.query_params.get("tail", 300)), 2000))
        except ValueError:
            tail = 300
        since = request.query_params.get("since", "")
        if since and not SINCE_RE.match(since):
            return Response({"since": ["بازهٔ زمانی نامعتبر است."]}, status=status.HTTP_400_BAD_REQUEST)
        server, bad = remote_server(request)
        if bad:
            return bad
        if server is not None:
            known = {x["service"] for x in service_logs.services_of(server)}
            if service != ALL and service not in known:
                return Response({"service": ["این سرویس روی این سرور لاگی ندارد."]}, status=status.HTTP_404_NOT_FOUND)
            return Response(service_logs.read(server, service, tail, since))
        try:
            if service == ALL:
                return Response(merged_logs(tail, since))
            return Response(control.call("GET", "/logs", params={"service": service, "tail": tail, "since": since}, timeout=40))
        except ControlError as e:
            return Response({"detail": e.message}, status=status.HTTP_503_SERVICE_UNAVAILABLE if e.offline else e.status)
