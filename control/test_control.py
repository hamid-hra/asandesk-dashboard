"""Tests for control.py. Docker is replaced by a fake, so nothing here needs a Docker daemon.

Run:  cd control && python -m pytest -q
"""

import json
import subprocess
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

import control

INFO = {"project": "asandesk-dashboard", "workdir": "/srv/asandesk-dashboard", "image": "asandesk-dashboard-control", "owner": "1000:1000"}


def done(stdout="", rc=0, stderr=""):
    return subprocess.CompletedProcess([], rc, stdout, stderr)


class FakeDocker:
    """Answers `docker ...` calls from a list of (predicate, result) rules and remembers every call."""

    def __init__(self):
        self.rules = []
        self.calls = []

    def when(self, *needle, result):
        self.rules.append((needle, result))

    def __call__(self, *args, timeout=30):
        self.calls.append(args)
        for needle, result in self.rules:
            if all(n in args for n in needle):
                return result(args) if callable(result) else result
        return done(rc=1, stderr="no such thing")


@pytest.fixture
def docker(monkeypatch):
    d = FakeDocker()
    monkeypatch.setattr(control, "docker", d)
    monkeypatch.setattr(control, "self_info", lambda: dict(INFO))
    return d


CHECK_OUTPUT = (
    "@@branch\nmain\n"
    "@@fetch\nFrom https://github.com/x/y\nrc=0\n"
    "@@head\n" + "a" * 40 + "\n"
    "@@counts\n0\t2\n"
    "@@dirty\n"
    "@@commits\n" + "b" * 40 + "\x1fHamid\x1f2026-10-13T10:00:00+03:30\x1fAdd the activity log\n" + "c" * 40 + "\x1fHamid\x1f2026-10-12T10:00:00+03:30\x1fFix\n"
    '@@diskver\nCHANGELOG = [{"version": "1.5.1", "date": "2026-10-07", "title": "t", "items": [("new", "x")]}]\nVERSION = CHANGELOG[0]["version"]\n'
    '@@remotever\nCHANGELOG = [{"version": "1.6.0", "date": "2026-10-13", "title": "جدید", "items": [("new", "لاگ فعالیت"), ("fix", "y")]}, {"version": "1.5.1", "date": "2026-10-07", "title": "t", "items": []}]\n'
)


# ---------------------------------------------------------------- check

def test_a_check_reads_branch_counts_commits_and_both_versions():
    check = control.build_check(control.parse_sections(CHECK_OUTPUT))
    assert check["branch"] == "main" and check["behind"] == 2 and check["ahead"] == 0 and check["dirty"] is False
    assert [c["subject"] for c in check["commits"]] == ["Add the activity log", "Fix"]
    assert check["disk_version"] == "1.5.1"
    assert [e["version"] for e in check["remote_changelog"]] == ["1.6.0", "1.5.1"]
    assert check["remote_changelog"][0]["items"] == [{"type": "new", "text": "لاگ فعالیت"}, {"type": "fix", "text": "y"}]


def test_uncommitted_changes_are_reported():
    out = CHECK_OUTPUT.replace("@@dirty\n", "@@dirty\n M docker-compose.yml\n")
    assert control.build_check(control.parse_sections(out))["dirty"] is True


def test_a_failed_fetch_says_why_and_mentions_the_proxy():
    out = CHECK_OUTPUT.replace("From https://github.com/x/y\nrc=0", "fatal: unable to access 'https://github.com/x/y/': Could not resolve host\nrc=128")
    with pytest.raises(control.ApiError) as e:
        control.build_check(control.parse_sections(out))
    assert "Could not resolve host" in e.value.message and "GIT_PROXY" in e.value.message


def test_detached_head_and_missing_remote_branch_are_errors():
    with pytest.raises(control.ApiError, match="detached"):
        control.build_check(control.parse_sections(CHECK_OUTPUT.replace("@@branch\nmain", "@@branch\nHEAD")))
    with pytest.raises(control.ApiError, match="origin/main"):
        control.build_check(control.parse_sections(CHECK_OUTPUT.replace("0\t2", "fatal: ambiguous argument")))


def test_unit_separator_does_not_split_a_commit_line():
    # str.splitlines() treats 0x1c-0x1e as line ends; the commit fields use 0x1f, which must stay inside the line
    sections = control.parse_sections("@@commits\nabc\x1fa\x1fd\x1fs\n")
    assert sections["commits"] == "abc\x1fa\x1fd\x1fs"


def test_the_version_file_is_read_as_data_never_executed(tmp_path):
    marker = tmp_path / "ran"
    evil = f'CHANGELOG = [open({str(marker)!r}, "w")]\n'
    assert control.parse_changelog(evil) == []
    assert not marker.exists()
    assert control.parse_changelog("this is not python (") == []
    assert control.parse_changelog("OTHER = 1") == []


def test_run_check_keeps_the_last_good_result_when_a_later_check_fails(monkeypatch):
    monkeypatch.setattr(control, "STATE", {"check": None, "check_error": ""})
    monkeypatch.setattr(control, "git_script", lambda script, timeout=60: done(CHECK_OUTPUT))
    control.run_check()
    assert control.STATE["check"]["behind"] == 2 and control.STATE["check_error"] == ""
    monkeypatch.setattr(control, "git_script", lambda script, timeout=60: done(CHECK_OUTPUT.replace("rc=0", "rc=1")))
    control.run_check()
    assert control.STATE["check"]["behind"] == 2 and control.STATE["check_error"] != ""


def test_the_check_script_uses_the_proxy_only_when_one_is_set(monkeypatch):
    monkeypatch.setattr(control, "PROXY", "")
    assert "http.proxy" not in control.check_script()
    monkeypatch.setattr(control, "PROXY", "http://127.0.0.1:10809")
    assert "http.proxy=http://127.0.0.1:10809" in control.check_script()
    assert "'safe.directory=*'" in control.check_script()  # quoted: the star must not be expanded by the shell


def test_ssh_remotes_of_github_are_fetched_over_https():
    # the helper container has no ssh and no keys: the real server failed with "cannot run ssh"
    for script in (control.check_script(), control.job_script("main", INFO)):
        assert "url.https://github.com/.insteadOf=git@github.com:" in script
        assert "url.https://github.com/.insteadOf=ssh://git@github.com/" in script


def test_a_private_repository_gets_a_clear_message():
    out = CHECK_OUTPUT.replace("From https://github.com/x/y\nrc=0", "git@github.com: Permission denied (publickey).\nrc=128")
    with pytest.raises(control.ApiError) as e:
        control.build_check(control.parse_sections(out))
    assert "خصوصی" in e.value.message


# ---------------------------------------------------------------- update job

def test_the_job_script_quotes_everything_it_is_given():
    script = control.job_script("x'; rm -rf /; echo '", {**INFO, "project": "p; reboot"})
    assert "rm -rf /" in script and "'x'\"'\"'; rm -rf /; echo '\"'\"''" in script  # inside shlex quotes
    assert "-p 'p; reboot'" in script
    assert script.index("git") < script.index("docker compose")  # pull first, then build
    assert "su-exec 1000:1000" in script  # git runs as the owner of the folder


def test_job_states(docker):
    docker.when("inspect", control.JOB_NAME, result=done(json.dumps({"Running": True, "ExitCode": 0, "StartedAt": "t0", "FinishedAt": "0001"})))
    docker.when("logs", result=done("\x1b[31m[1/2] pull\x1b[0m\nDONE\n"))
    s = control.job_state()
    assert s["state"] == "running" and s["finished_at"] is None and "\x1b" not in s["log"] and "[1/2] pull" in s["log"]

    docker.rules.clear()
    docker.when("inspect", control.JOB_NAME, result=done(json.dumps({"Running": False, "ExitCode": 0, "StartedAt": "a", "FinishedAt": "b"})))
    assert control.job_state(with_log=False)["state"] == "ok"
    docker.rules.clear()
    docker.when("inspect", control.JOB_NAME, result=done(json.dumps({"Running": False, "ExitCode": 11, "StartedAt": "a", "FinishedAt": "b"})))
    assert control.job_state(with_log=False) | {} == {"state": "failed", "exit_code": 11, "started_at": "a", "finished_at": "b"}
    docker.rules.clear()
    assert control.job_state() == {"state": "none"}


def test_start_refuses_a_second_job(docker):
    docker.when("inspect", control.JOB_NAME, result=done(json.dumps({"Running": True, "ExitCode": 0})))
    with pytest.raises(control.ApiError) as e:
        control.start_job()
    assert e.value.status == 409
    assert not any(c[:2] == ("run", "-d") for c in docker.calls)


def test_start_runs_a_detached_job_outside_the_compose_project(docker, monkeypatch):
    monkeypatch.setattr(control, "git_script", lambda script, timeout=60: done("main\n"))
    monkeypatch.setattr(control, "STATE", {"check": {"behind": 3}, "check_error": "old"})
    docker.when("run", "-d", result=done("abc123\n"))
    docker.when("rm", result=done())
    control.start_job()
    assert control.STATE == {"check": None, "check_error": ""}  # the old "3 behind" would be wrong once the job has pulled
    run = next(c for c in docker.calls if c[:2] == ("run", "-d"))
    assert "--rm" not in run  # the finished job stays, so the panel can show its log
    assert control.JOB_NAME in run and "/var/run/docker.sock:/var/run/docker.sock" in run
    assert f"{INFO['workdir']}:{INFO['workdir']}" in run  # the project at its real path
    assert not any(a.startswith("com.docker.compose") for a in run)  # not a compose service, so `up` never touches it
    assert docker.calls.index(("rm", "-f", control.JOB_NAME)) < docker.calls.index(run)


@pytest.mark.parametrize("branch", ["", "HEAD", "main; reboot", "a b"])
def test_start_refuses_an_odd_branch(docker, monkeypatch, branch):
    monkeypatch.setattr(control, "git_script", lambda script, timeout=60: done(branch + "\n"))
    with pytest.raises(control.ApiError):
        control.start_job()
    assert not any(c[:2] == ("run", "-d") for c in docker.calls)


# ---------------------------------------------------------------- logs

PS = "asandesk-dashboard-backend-1|backend|running|Up 2 hours\nasandesk-dashboard-db-1|db|running|Up 2 hours\nasandesk-dashboard-control-1|control|running|Up 5 minutes\nasandesk-dashboard-nginx-1|nginx|exited|Exited (1)\n"


def test_services_come_in_a_stable_order_with_the_update_job_last(docker):
    docker.when("ps", result=done(PS))
    docker.when("inspect", control.JOB_NAME, result=done("exited|false\n"))
    names = [s["service"] for s in control.services()]
    assert names == ["backend", "nginx", "db", "control", "update-job"]


def test_logs_merge_both_streams_by_time_and_drop_colour_codes(docker):
    docker.when("ps", result=done(PS))
    docker.when("inspect", control.JOB_NAME, result=done(rc=1))
    docker.when("logs", result=done(
        "2026-10-13T10:00:01.000000000Z \x1b[32mGET /api/x 200\x1b[0m\n2026-10-13T10:00:03.000000000Z third\n",
        stderr="2026-10-13T10:00:02.000000000Z second (stderr)\n",
    ))
    out = control.container_logs("backend", 300, "")
    assert [line["text"] for line in out["lines"]] == ["GET /api/x 200", "second (stderr)", "third"]
    assert [line["stream"] for line in out["lines"]] == ["out", "err", "out"]
    logs_call = next(c for c in docker.calls if c[0] == "logs")
    assert logs_call[-1] == "asandesk-dashboard-backend-1" and "300" in logs_call


def test_logs_only_for_this_projects_services_and_clean_parameters(docker):
    docker.when("ps", result=done(PS))
    docker.when("inspect", control.JOB_NAME, result=done(rc=1))
    with pytest.raises(control.ApiError) as e:
        control.container_logs("postgres-of-someone-else", 100, "")
    assert e.value.status == 404
    for bad in ["../x", "A", "", "a b", "x;y"]:
        with pytest.raises(control.ApiError) as e:
            control.container_logs(bad, 100, "")
        assert e.value.status == 400
    with pytest.raises(control.ApiError):
        control.container_logs("backend", 100, "1 day")
    assert not any(c[0] == "logs" for c in docker.calls)


def test_log_size_is_capped_from_the_old_end(docker, monkeypatch):
    docker.when("ps", result=done(PS))
    docker.when("inspect", control.JOB_NAME, result=done(rc=1))
    big = "".join(f"2026-10-13T10:{i // 60:02d}:{i % 60:02d}.000000000Z {'x' * 1000}\n" for i in range(2000))
    docker.when("logs", result=done(big))
    monkeypatch.setattr(control, "MAX_LOG_CHARS", 100_000)
    lines = control.container_logs("backend", 2000, "")["lines"]
    assert 0 < sum(len(line["text"]) for line in lines) <= 100_000
    assert lines[-1]["ts"] == "2026-10-13T10:33:19.000000000Z"  # the newest line (#1999) is kept


# ---------------------------------------------------------------- HTTP and token

@pytest.fixture
def server(monkeypatch):
    monkeypatch.setattr(control, "TOKEN", "s3cret-token")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), control.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def fetch(base, path, method="GET", token=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # a system proxy must not see localhost
    req = urllib.request.Request(base + path, method=method, data=b"" if method == "POST" else None, headers={"X-Control-Token": token} if token else {})
    try:
        with opener.open(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_everything_but_health_needs_the_token(server, monkeypatch):
    monkeypatch.setattr(control, "status_body", lambda: {"check": None, "job": {"state": "none"}})
    assert fetch(server, "/health") == (200, {"ok": True})
    assert fetch(server, "/update/status")[0] == 401
    assert fetch(server, "/update/status", token="wrong")[0] == 401
    assert fetch(server, "/update/status", method="POST", token="")[0] == 401
    assert fetch(server, "/update/status", token="s3cret-token") == (200, {"check": None, "job": {"state": "none"}})
    assert fetch(server, "/nope", token="s3cret-token")[0] == 404


def test_an_empty_token_never_authorizes(server, monkeypatch):
    monkeypatch.setattr(control, "TOKEN", "")
    assert fetch(server, "/services", token="")[0] == 401


def test_errors_keep_their_status_and_message(server, monkeypatch):
    def refuse():
        raise control.ApiError("یک به‌روزرسانی هم‌اکنون در جریان است.", 409)

    monkeypatch.setattr(control, "start_job", refuse)
    code, body = fetch(server, "/update/start", method="POST", token="s3cret-token")
    assert code == 409 and "در جریان" in body["error"]

    def explode():
        raise RuntimeError("secret path /etc/shadow")

    monkeypatch.setattr(control, "start_job", explode)
    code, body = fetch(server, "/update/start", method="POST", token="s3cret-token")
    assert code == 500 and "shadow" not in body["error"]  # internals stay in the service log


def test_the_token_is_created_once_and_reused(tmp_path, monkeypatch):
    monkeypatch.setattr(control, "TOKEN_FILE", tmp_path / "run" / "token")
    first = control.load_token()
    assert len(first) >= 32 and (tmp_path / "run" / "token").read_text() == first
    assert control.load_token() == first
