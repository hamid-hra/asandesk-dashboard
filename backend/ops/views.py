"""Settings → panel update and docker logs. Owner only: these reach the host's Docker."""

import re
from concurrent.futures import ThreadPoolExecutor

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsOwner
from activity.service import record
from backups.models import Operation
from config.version import VERSION

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


class ServicesView(OwnerView):
    def get(self, request):
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
        try:
            if service == ALL:
                return Response(merged_logs(tail, since))
            return Response(control.call("GET", "/logs", params={"service": service, "tail": tail, "since": since}, timeout=40))
        except ControlError as e:
            return Response({"detail": e.message}, status=status.HTTP_503_SERVICE_UNAVAILABLE if e.offline else e.status)
