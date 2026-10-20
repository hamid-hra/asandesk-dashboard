#!/usr/bin/env python3
"""AsanDesk control service: the one place that talks to Docker for the panel.

The panel (Settings → «به‌روزرسانی پنل» and «لاگ داکر») needs three things the backend must not be
trusted with, because Docker access is root on the host:

  * read the logs of this compose project's containers,
  * check GitHub for a newer panel version,
  * run `git pull` + `docker compose up -d --build` for this project,
  * the same for an Asan-desk-agent installed with docker compose on this server (found by its
    `asandesk.agent` label), so the agent can be updated from the panel too.

So they live here. This service is not published on any port; only the backend reaches it over the
compose network, and it must send the token that this service creates in a shared volume.

The git commands and the update itself run in short-lived helper containers started from this same
image: with the host network (so a proxy on 127.0.0.1 of the server works, as it does for the
build), as the owner of the project folder (so no root-owned files appear in .git) and with the
project mounted at its real path (so docker compose resolves every relative path correctly). The
update job is not part of the compose project, so it survives the restart of the services it replaces.
"""

import ast
import hmac
import json
import os
import re
import secrets
import shlex
import socket
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

TOKEN_FILE = Path(os.environ.get("CONTROL_TOKEN_FILE", "/run/control/token"))
PORT = int(os.environ.get("CONTROL_PORT", "8100"))
JOB_NAME = "asandesk-update-job"
AGENT_JOB_NAME = "asandesk-agent-update-job"
AGENT_LABEL = "asandesk.agent=true"
VERSION_FILE = "backend/config/version.py"
AGENT_VERSION_FILE = "agent.py"
FIRST_CHECK_AFTER = 90  # seconds after start
CHECK_EVERY = 6 * 3600
FETCH_TIMEOUT = 45  # nginx cuts a panel request at 60 s
MAX_CHANGELOG = 15
MAX_LOG_CHARS = 600_000
PROXY = (os.environ.get("GIT_PROXY") or os.environ.get("BUILD_PROXY") or "").strip()

SERVICE_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
WORKDIR_RE = re.compile(r"^/[\w./@+-]{1,300}$")  # keeps ":" (extra docker -v options) and spaces out of a path taken from a container label
SINCE_RE = re.compile(r"^\d{1,4}[smh]$")
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
STAMP_RE = re.compile(r"^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$")
SERVICE_ORDER = ["backend", "frontend", "nginx", "db", "scheduler", "control"]

TOKEN = ""
STATE = {"check": None, "check_error": ""}
AGENT_STATE: dict[str, dict] = {}  # compose project of an agent → its last check
AGENT_OWNERS: dict[str, str] = {}  # project folder → "uid:gid"
CHECK_LOCK = threading.Lock()
JOB_LOCK = threading.Lock()
_info = {"at": 0.0, "value": None}


class ApiError(Exception):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- docker

def docker(*args: str, timeout: float = 30) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["docker", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise ApiError("داکر در زمان مجاز پاسخ نداد.", 504) from e
    except FileNotFoundError as e:
        raise ApiError("برنامهٔ docker در کانتینر control نصب نیست.") from e


def clean(text: str) -> str:
    return ANSI_RE.sub("", text or "").replace("\r", "")


def self_info() -> dict:
    """Project name, project folder on the host and image of this very container (cached a minute)."""
    if _info["value"] and time.monotonic() - _info["at"] < 60:
        return _info["value"]
    r = docker("inspect", socket.gethostname())
    if r.returncode != 0:
        raise ApiError("کانتینر خودِ control پیدا نشد: " + clean(r.stderr)[:200])
    data = json.loads(r.stdout)[0]
    labels = data["Config"].get("Labels") or {}
    project = labels.get("com.docker.compose.project")
    workdir = labels.get("com.docker.compose.project.working_dir")
    if not project or not workdir:
        raise ApiError("control باید با docker compose اجرا شود (برچسب پروژه پیدا نشد).")
    value = _info["value"] or {}
    if value.get("workdir") != workdir:
        value = {"owner": None}
    value.update(project=project, workdir=workdir, image=data["Config"]["Image"])
    if not value.get("owner"):
        value["owner"] = folder_owner(workdir, value["image"])
    _info.update(at=time.monotonic(), value=value)
    return value


def folder_owner(workdir: str, image: str) -> str:
    """The user id and group id that own a project folder: git runs as them, so .git never gets root-owned files."""
    r = docker("run", "--rm", "-v", f"{workdir}:{workdir}:ro", "-w", workdir, image, "sh", "-c", "stat -c %u:%g .git 2>/dev/null || stat -c %u:%g .")
    owner = r.stdout.strip().split("\n")[-1] if r.returncode == 0 else ""
    if not re.fullmatch(r"\d+:\d+", owner):
        raise ApiError("پوشهٔ پروژه از داخل کانتینر خوانده نشد: " + clean(r.stderr)[:200])
    return owner


# ---------------------------------------------------------------- git (in helper containers)

def git_prefix() -> str:
    args = [
        "git", "-c", "safe.directory=*",
        # The server's clone often has an SSH remote (git@github.com:owner/repo.git), but the helper
        # container has neither ssh nor keys. The repository is public, so GitHub is fetched over https.
        "-c", "url.https://github.com/.insteadOf=git@github.com:",
        "-c", "url.https://github.com/.insteadOf=ssh://git@github.com/",
    ]
    if PROXY:
        args += ["-c", f"http.proxy={PROXY}"]
    return shlex.join(args)


def git_script(script: str, timeout: float = 60, info: dict | None = None) -> subprocess.CompletedProcess:
    """Run a shell script in a helper container: host network, owner of the project, project at its real path."""
    info = info or self_info()
    host = info["workdir"]
    return docker(
        "run", "--rm", "--network", "host", "--user", info["owner"], "-v", f"{host}:{host}", "-w", host,
        "-e", "HOME=/tmp", "-e", "GIT_TERMINAL_PROMPT=0", info["image"], "sh", "-c", script, timeout=timeout,
    )


def parse_sections(text: str) -> dict[str, str]:
    """Split the output of the check script at its `@@name` marker lines."""
    out: dict[str, list[str]] = {}
    cur = None
    for line in clean(text).split("\n"):  # not splitlines(): that would also cut at the 0x1c-0x1e separators
        if line.startswith("@@"):
            cur = line[2:].strip()
            out[cur] = []
        elif cur is not None:
            out[cur].append(line)
    return {k: "\n".join(v).strip("\n") for k, v in out.items()}


def parse_changelog(source: str) -> list[dict]:
    """The CHANGELOG list of backend/config/version.py, read as data: the file is never executed."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "CHANGELOG" for t in node.targets):
            try:
                raw = ast.literal_eval(node.value)
            except (ValueError, SyntaxError):
                return []
            out = []
            for e in raw[:MAX_CHANGELOG]:
                if isinstance(e, dict) and e.get("version"):
                    items = [{"type": str(t), "text": str(x)} for t, x in e.get("items", []) if isinstance((t, x), tuple)]
                    out.append({"version": str(e["version"]), "date": str(e.get("date", "")), "title": str(e.get("title", "")), "items": items})
            return out
    return []


def check_script(version_file: str = VERSION_FILE) -> str:
    g = git_prefix()
    return f"""
BR=$({g} rev-parse --abbrev-ref HEAD 2>&1)
echo @@branch; echo "$BR"
echo @@fetch; timeout {FETCH_TIMEOUT} {g} fetch --prune origin 2>&1; echo "rc=$?"
echo @@head; {g} rev-parse HEAD 2>&1
echo @@counts; {g} rev-list --left-right --count "HEAD...origin/$BR" 2>&1
echo @@dirty; {g} status --porcelain --untracked-files=no 2>&1 | head -20
echo @@commits; {g} log -n 30 --format='%H%x1f%an%x1f%aI%x1f%s' "HEAD..origin/$BR" 2>&1
echo @@diskver; {g} show HEAD:{version_file} 2>&1
echo @@remotever; {g} show "origin/$BR:{version_file}" 2>&1
"""


def build_check(sections: dict[str, str], agent: bool = False) -> dict:
    branch = sections.get("branch", "").strip()
    if not branch or branch == "HEAD" or " " in branch:
        raise ApiError("پوشهٔ پروژه روی یک commit ثابت است (detached HEAD)؛ روی یک شاخه مثل main باشید.")
    fetch = sections.get("fetch", "")
    if not fetch.rstrip().endswith("rc=0"):
        reason = clean(fetch).replace("rc=", "").strip().splitlines()
        detail = " ".join(reason[-3:])[:300] or "بدون پیام"
        hint = " (اگر سرور به GitHub مستقیم نمی‌رسد، GIT_PROXY را در .env بگذارید.)"
        if "Permission denied" in detail or "Authentication failed" in detail or "could not read Username" in detail:
            hint = " (مخزن خصوصی است؟ این بخش فقط مخزن عمومی را بدون رمز می‌گیرد؛ آدرس origin را با توکن در خودش بگذارید.)"
        raise ApiError("گرفتن تغییرات از GitHub نشد: " + detail + hint)
    m = re.fullmatch(r"(\d+)\s+(\d+)", sections.get("counts", "").strip())
    if not m:
        raise ApiError(f"شاخهٔ origin/{branch} پیدا نشد.")
    ahead, behind = int(m.group(1)), int(m.group(2))
    commits = []
    for line in sections.get("commits", "").split("\n"):
        parts = line.split("\x1f")
        if len(parts) == 4:
            commits.append({"sha": parts[0], "author": parts[1], "date": parts[2], "subject": parts[3]})
    base = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "branch": branch,
        "head": sections.get("head", "").strip(),
        "ahead": ahead,
        "behind": behind,
        "dirty": bool(sections.get("dirty", "").strip()),
        "commits": commits,
    }
    if agent:
        return {**base, "disk_version": parse_agent_version(sections.get("diskver", "")), "remote_version": parse_agent_version(sections.get("remotever", ""))}
    disk = parse_changelog(sections.get("diskver", ""))
    return {**base, "disk_version": disk[0]["version"] if disk else "", "remote_changelog": parse_changelog(sections.get("remotever", ""))}


AGENT_VERSION_RE = re.compile(r'^VERSION\s*=\s*"([\w.+-]{1,32})"', re.M)


def parse_agent_version(source: str) -> str:
    m = AGENT_VERSION_RE.search(source or "")
    return m.group(1) if m else ""


def run_check() -> None:
    """Fetch and compare. The result (or the reason it failed) is kept for the panel."""
    with CHECK_LOCK:
        try:
            r = git_script(check_script(), timeout=FETCH_TIMEOUT + 25)
            STATE["check"] = build_check(parse_sections(r.stdout))
            STATE["check_error"] = ""
        except ApiError as e:
            STATE["check_error"] = e.message


# ---------------------------------------------------------------- update job

def job_script(branch: str, info: dict) -> str:
    g = git_prefix()
    return "\n".join([
        "exec 2>&1",
        f"echo '[1/2] git pull --ff-only origin '{shlex.quote(branch)}",
        f"su-exec {shlex.quote(info['owner'])} env HOME=/tmp GIT_TERMINAL_PROMPT=0 {g} pull --ff-only origin {shlex.quote(branch)} || {{ echo 'FAILED: git pull'; exit 11; }}",
        "echo '[2/2] docker compose up -d --build'",
        # without the buildx plugin compose falls back to the classic builder, which cannot run the
        # Dockerfiles' `RUN --mount=type=cache` steps; say so up front instead of failing cryptically
        "docker buildx version > /dev/null 2>&1 || echo 'WARNING: the buildx plugin is missing in the control image, so the build may fail on RUN --mount. Fix once on the server: docker compose up -d --build'",
        f"docker compose -p {shlex.quote(info['project'])} --ansi never up -d --build || {{ rc=$?; echo \"FAILED: docker compose (exit $rc)\"; exit $rc; }}",
        "echo DONE",
    ])


def job_state(with_log: bool = True, name: str = JOB_NAME) -> dict:
    r = docker("inspect", name, "--format", "{{json .State}}")
    if r.returncode != 0:
        return {"state": "none"}
    st = json.loads(r.stdout)
    running = bool(st.get("Running"))
    out = {
        "state": "running" if running else ("ok" if st.get("ExitCode") == 0 else "failed"),
        "exit_code": None if running else st.get("ExitCode"),
        "started_at": st.get("StartedAt"),
        "finished_at": None if running else st.get("FinishedAt"),
    }
    if with_log:
        logs = docker("logs", "--tail", "800", name)
        out["log"] = clean(logs.stdout + logs.stderr)[-60_000:]
    return out


def start_job() -> None:
    with JOB_LOCK:
        if job_state(with_log=False)["state"] == "running":
            raise ApiError("یک به‌روزرسانی هم‌اکنون در جریان است.", 409)
        info = self_info()
        r = git_script(f"{git_prefix()} rev-parse --abbrev-ref HEAD", timeout=30)
        branch = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
        if not branch or branch == "HEAD" or not re.fullmatch(r"[\w./-]+", branch):
            raise ApiError("شاخهٔ پروژه مشخص نشد (detached HEAD؟).")
        docker("rm", "-f", JOB_NAME)
        host = info["workdir"]
        r = docker(
            "run", "-d", "--name", JOB_NAME, "--network", "host", "--label", "asandesk.control=update-job",
            "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", f"{host}:{host}", "-w", host,
            "-e", "BUILDKIT_PROGRESS=plain", "-e", "COMPOSE_ANSI=never",
            info["image"], "sh", "-c", job_script(branch, info),
        )
        if r.returncode != 0:
            raise ApiError("شروع کار به‌روزرسانی ممکن نشد: " + clean(r.stderr)[:300])
        # the last check described the code from before this update; the panel checks again when it is done
        STATE["check"] = None
        STATE["check_error"] = ""


# ---------------------------------------------------------------- agents (Asan-desk-agent installed with docker compose)

def agent_projects() -> list[dict]:
    """Agents on this server: containers labelled asandesk.agent=true that docker compose started.

    An agent started with a plain `docker run` has no project folder to `git pull` in, so it is not found;
    reinstall it with the compose file of the Asan-desk-agent repository once.
    """
    r = docker("ps", "-a", "--filter", f"label={AGENT_LABEL}", "--format",
               '{{.Names}}|{{.State}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.project.working_dir"}}')
    if r.returncode != 0:
        raise ApiError("فهرست کانتینرها خوانده نشد: " + clean(r.stderr)[:200])
    own = self_info()["project"]
    out: dict[str, dict] = {}
    for line in r.stdout.splitlines():
        name, _, rest = line.partition("|")
        state, _, rest = rest.partition("|")
        project, _, workdir = rest.partition("|")
        if project and SERVICE_RE.match(project) and WORKDIR_RE.match(workdir) and project != own and project not in out:
            out[project] = {"name": name, "state": state, "project": project, "workdir": workdir}
    return sorted(out.values(), key=lambda a: a["project"])


def agent_info(agent: dict) -> dict:
    image = self_info()["image"]
    if agent["workdir"] not in AGENT_OWNERS:
        AGENT_OWNERS[agent["workdir"]] = folder_owner(agent["workdir"], image)
    return {"project": agent["project"], "workdir": agent["workdir"], "image": image, "owner": AGENT_OWNERS[agent["workdir"]]}


def run_agent_checks() -> None:
    """Fetch each agent's repository and compare with its origin; failures are kept per agent."""
    for a in agent_projects():
        try:
            r = git_script(check_script(AGENT_VERSION_FILE), timeout=FETCH_TIMEOUT + 25, info=agent_info(a))
            AGENT_STATE[a["project"]] = {"check": build_check(parse_sections(r.stdout), agent=True), "error": ""}
        except ApiError as e:
            AGENT_STATE[a["project"]] = {"check": None, "error": e.message}


def agents_body() -> dict:
    out = []
    for a in agent_projects():
        known = AGENT_STATE.get(a["project"]) or {"check": None, "error": ""}
        out.append({**a, **known})
    return {"agents": out, "job": job_state(name=AGENT_JOB_NAME)}


def start_agent_job(project: str) -> None:
    with JOB_LOCK:
        if job_state(with_log=False, name=AGENT_JOB_NAME)["state"] == "running":
            raise ApiError("یک به‌روزرسانی ایجنت هم‌اکنون در جریان است.", 409)
        agent = next((a for a in agent_projects() if a["project"] == project), None)
        if not agent:
            raise ApiError("چنین ایجنتی روی این سرور پیدا نشد.", 404)
        info = agent_info(agent)
        r = git_script(f"{git_prefix()} rev-parse --abbrev-ref HEAD", timeout=30, info=info)
        branch = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
        if not branch or branch == "HEAD" or not re.fullmatch(r"[\w./-]+", branch):
            raise ApiError("شاخهٔ پروژهٔ ایجنت مشخص نشد (detached HEAD؟).")
        docker("rm", "-f", AGENT_JOB_NAME)
        host = info["workdir"]
        r = docker(
            "run", "-d", "--name", AGENT_JOB_NAME, "--network", "host", "--label", "asandesk.control=agent-update-job",
            "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", f"{host}:{host}", "-w", host,
            "-e", "BUILDKIT_PROGRESS=plain", "-e", "COMPOSE_ANSI=never",
            info["image"], "sh", "-c", job_script(branch, info),
        )
        if r.returncode != 0:
            raise ApiError("شروع به‌روزرسانی ایجنت ممکن نشد: " + clean(r.stderr)[:300])
        AGENT_STATE.pop(project, None)  # the next check describes the new code


# ---------------------------------------------------------------- logs

def services() -> list[dict]:
    info = self_info()
    r = docker("ps", "-a", "--filter", f"label=com.docker.compose.project={info['project']}", "--format", '{{.Names}}|{{.Label "com.docker.compose.service"}}|{{.State}}|{{.Status}}')
    if r.returncode != 0:
        raise ApiError("فهرست کانتینرها خوانده نشد: " + clean(r.stderr)[:200])
    out = {}
    for line in r.stdout.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4 and parts[1] and parts[1] not in out:
            out[parts[1]] = {"service": parts[1], "container": parts[0], "state": parts[2], "status": parts[3]}
    ordered = sorted(out.values(), key=lambda s: (SERVICE_ORDER.index(s["service"]) if s["service"] in SERVICE_ORDER else 99, s["service"]))
    job = docker("inspect", JOB_NAME, "--format", "{{.State.Status}}|{{.State.Running}}")
    if job.returncode == 0:
        status, _, running = job.stdout.strip().partition("|")
        ordered.append({"service": "update-job", "container": JOB_NAME, "state": "running" if running == "true" else "exited", "status": status})
    return ordered


def parse_log_stream(text: str, stream: str) -> list[dict]:
    lines = []
    for raw in clean(text).splitlines():
        m = STAMP_RE.match(raw)
        lines.append({"ts": m.group(1) if m else "", "stream": stream, "text": m.group(2) if m else raw})
    return lines


def container_logs(service: str, tail: int, since: str) -> dict:
    if not SERVICE_RE.match(service):
        raise ApiError("سرویس نامعتبر است.", 400)
    if since and not SINCE_RE.match(since):
        raise ApiError("بازهٔ زمانی نامعتبر است.", 400)
    target = next((s for s in services() if s["service"] == service), None)
    if not target:
        raise ApiError("چنین سرویسی در این پروژه نیست.", 404)
    args = ["logs", "--timestamps", "--tail", str(max(10, min(tail, 2000)))]
    if since:
        args += ["--since", since]
    r = docker(*args, target["container"], timeout=40)
    if r.returncode != 0:
        raise ApiError("خواندن لاگ ممکن نشد: " + clean(r.stderr)[:200])
    lines = parse_log_stream(r.stdout, "out") + parse_log_stream(r.stderr, "err")
    lines.sort(key=lambda line: line["ts"])  # stdout and stderr come separately; the timestamps interleave them again
    while lines and sum(len(line["text"]) for line in lines) > MAX_LOG_CHARS:
        lines = lines[len(lines) // 10 + 1:]
    return {"service": service, "container": target["container"], "state": target["state"], "lines": lines}


# ---------------------------------------------------------------- HTTP

def load_token() -> str:
    try:
        token = TOKEN_FILE.read_text().strip()
        if token:
            return token
    except OSError:
        pass
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(token)
    os.chmod(TOKEN_FILE, 0o644)  # the volume is mounted read-only into the backend only
    return token


def status_body() -> dict:
    return {"check": STATE["check"], "check_error": STATE["check_error"], "job": job_state()}


class Handler(BaseHTTPRequestHandler):
    server_version = "control"

    def log_message(self, fmt, *args):  # the default prints the client address and full request line
        sys.stderr.write("control: " + (fmt % args) + "\n")

    def send_json(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def authorized(self) -> bool:
        return bool(TOKEN) and hmac.compare_digest(self.headers.get("X-Control-Token", ""), TOKEN)

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def route(self, method: str) -> None:
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        if method == "POST":  # bodies carry nothing we need; drain a small one
            self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 4096))
        if method == "GET" and url.path == "/health":
            return self.send_json(200, {"ok": True})
        if not self.authorized():
            return self.send_json(401, {"error": "توکن نامعتبر است."})
        try:
            if (method, url.path) == ("GET", "/update/status"):
                return self.send_json(200, status_body())
            if (method, url.path) == ("POST", "/update/check"):
                run_check()
                return self.send_json(200, status_body())
            if (method, url.path) == ("POST", "/update/start"):
                start_job()
                return self.send_json(202, status_body())
            if (method, url.path) == ("GET", "/agents"):
                return self.send_json(200, agents_body())
            if (method, url.path) == ("POST", "/agents/check"):
                run_agent_checks()
                return self.send_json(200, agents_body())
            if (method, url.path) == ("POST", "/agents/update"):
                start_agent_job(query.get("project", ""))
                return self.send_json(202, agents_body())
            if (method, url.path) == ("GET", "/services"):
                return self.send_json(200, {"services": services()})
            if (method, url.path) == ("GET", "/logs"):
                try:
                    tail = int(query.get("tail", 300))
                except ValueError:
                    tail = 300
                return self.send_json(200, container_logs(query.get("service", ""), tail, query.get("since", "")))
            return self.send_json(404, {"error": "مسیر ناشناخته."})
        except ApiError as e:
            return self.send_json(e.status, {"error": e.message})
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json(500, {"error": "خطای داخلی control؛ لاگ سرویس control را ببینید."})


def auto_check() -> None:
    time.sleep(FIRST_CHECK_AFTER)
    while True:
        for check in (run_check, run_agent_checks):
            try:
                check()
            except Exception:  # noqa: BLE001
                traceback.print_exc()
        time.sleep(CHECK_EVERY)


def main() -> None:
    global TOKEN
    TOKEN = load_token()
    threading.Thread(target=auto_check, daemon=True).start()
    print(f"control: listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
