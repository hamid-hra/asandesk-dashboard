import pytest
from rest_framework.test import APIClient

from accounts.models import Role, User
from activity.models import ActivityLog
from backups.models import Operation
from config.version import VERSION
from ops import control, views
from ops.control import ControlError


def as_user(role, perms=None, username=None):
    u = User.objects.create_user(username=username or f"u-{role}", password="x-Pass-12345", role=role, perms=perms or {})
    c = APIClient()
    c.force_authenticate(u)
    return c, u


def check_payload(**over):
    base = {
        "checked_at": "2026-10-13T10:00:00+00:00",
        "branch": "main",
        "behind": 2,
        "ahead": 0,
        "dirty": False,
        "commits": [{"sha": "a" * 40, "author": "x", "date": "2026-10-13T09:00:00+00:00", "subject": "Fix"}],
        "disk_version": VERSION,
        "remote_changelog": [
            {"version": "9.9.0", "date": "2026-10-20", "title": "جدید", "items": [{"type": "new", "text": "چیزی"}]},
            {"version": "9.8.0", "date": "2026-10-19", "title": "میانی", "items": []},
            {"version": VERSION, "date": "2026-10-13", "title": "فعلی", "items": []},
            {"version": "0.0.1", "date": "2026-01-01", "title": "قدیمی", "items": []},
        ],
    }
    return {**base, **over}


class FakeControl:
    """Stands in for ops.control.call and records what the panel asked for."""

    def __init__(self, status=None, error=None):
        self.status = status or {"check": check_payload(), "job": None}
        self.error = error
        self.calls = []

    def __call__(self, method, path, **kw):
        self.calls.append((method, path, kw))
        if self.error:
            raise self.error
        if path == "/services":
            return {"services": [{"service": "backend", "state": "running"}]}
        if path == "/logs":
            return {"service": kw["params"]["service"], "lines": []}
        return self.status


@pytest.fixture
def fake(monkeypatch):
    f = FakeControl()
    monkeypatch.setattr(control, "call", f)
    return f


# ---------------- فقط مالک ----------------

@pytest.mark.django_db
@pytest.mark.parametrize("role,perms", [(Role.ADMIN, {}), (Role.VIEWER, {}), (Role.CUSTOM, {"system": "edit", "backup": "edit", "activity": "view"})])
def test_nobody_but_the_owner_reaches_the_server_controls(fake, role, perms):
    c, _ = as_user(role, perms)
    for method, path in [("get", "/api/settings/system/update"), ("post", "/api/settings/system/update/check"), ("post", "/api/settings/system/update/start"),
                         ("get", "/api/settings/system/logs/services"), ("get", "/api/settings/system/logs?service=backend")]:
        assert getattr(c, method)(path).status_code == 403, path
    assert fake.calls == []  # حتی تماسی با control گرفته نشد


# ---------------- بررسی نسخه ----------------

@pytest.mark.django_db
def test_update_status_lists_what_is_new_since_the_running_version(fake):
    c, _ = as_user(Role.OWNER)
    body = c.get("/api/settings/system/update").json()
    check = body["check"]
    assert body["version"] == VERSION and body["control"]["online"] is True
    assert check["available"] is True and check["behind"] == 2 and check["remote_version"] == "9.9.0"
    assert [e["version"] for e in check["new_entries"]] == ["9.9.0", "9.8.0"]  # فقط تازه‌تر از نسخهٔ در حال اجرا


@pytest.mark.django_db
def test_up_to_date_when_nothing_is_behind(fake):
    fake.status = {"check": check_payload(behind=0, remote_changelog=[{"version": VERSION, "date": "2026-10-13", "title": "t", "items": []}]), "job": None}
    c, _ = as_user(Role.OWNER)
    check = c.get("/api/settings/system/update").json()["check"]
    assert check["available"] is False and check["new_entries"] == []


@pytest.mark.django_db
def test_code_pulled_by_hand_but_not_built_counts_as_an_update(fake):
    fake.status = {"check": check_payload(behind=0, disk_version="9.9.0"), "job": None}
    c, _ = as_user(Role.OWNER)
    check = c.get("/api/settings/system/update").json()["check"]
    assert check["pending_build"] is True and check["available"] is True


@pytest.mark.django_db
def test_no_check_yet_and_a_failed_check(fake):
    fake.status = {"check": None, "job": None}
    c, _ = as_user(Role.OWNER)
    assert c.get("/api/settings/system/update").json()["check"] is None
    fake.status = {"check": None, "check_error": "git fetch ناموفق بود", "job": None}
    assert c.get("/api/settings/system/update").json()["check_error"] == "git fetch ناموفق بود"


@pytest.mark.django_db
def test_the_panel_works_when_control_is_down(monkeypatch):
    monkeypatch.setattr(control, "call", FakeControl(error=ControlError("وصل نشد", offline=True)))
    c, _ = as_user(Role.OWNER)
    body = c.get("/api/settings/system/update").json()
    assert body["control"] == {"online": False, "error": "وصل نشد"} and body["check"] is None
    assert c.post("/api/settings/system/update/check").json()["control"]["online"] is False
    assert c.get("/api/settings/system/logs/services").status_code == 503


def test_entries_after_stops_at_the_running_version_and_is_capped():
    log = [{"version": f"2.0.{i}"} for i in range(30, 0, -1)]
    assert len(views.entries_after(log, "1.0.0")) == views.MAX_NEW_ENTRIES  # نسخهٔ فعلی در فهرست نیست
    assert [e["version"] for e in views.entries_after(log, "2.0.28")] == ["2.0.30", "2.0.29"]


# ---------------- شروع به‌روزرسانی ----------------

@pytest.mark.django_db
def test_start_runs_the_job_and_leaves_a_trace(fake):
    c, owner = as_user(Role.OWNER, username="boss")
    r = c.post("/api/settings/system/update/start")
    assert r.status_code == 202
    assert ("POST", "/update/start") in [(m, p) for m, p, _ in fake.calls]
    row = ActivityLog.objects.get(action="system.update")
    assert row.username == "boss" and "9.9.0" in row.text and VERSION in row.text


@pytest.mark.django_db
def test_start_waits_for_a_running_backup(fake):
    Operation.objects.create(kind=Operation.Kind.BACKUP, status=Operation.Status.RUNNING)
    c, _ = as_user(Role.OWNER)
    assert c.post("/api/settings/system/update/start").status_code == 409
    assert fake.calls == []
    assert not ActivityLog.objects.filter(action="system.update").exists()


@pytest.mark.django_db
def test_a_job_that_is_already_running_is_reported_not_restarted(monkeypatch):
    monkeypatch.setattr(control, "call", FakeControl(error=ControlError("یک به‌روزرسانی در جریان است.", status=409)))
    c, _ = as_user(Role.OWNER)
    r = c.post("/api/settings/system/update/start")
    assert r.status_code == 409 and "در جریان" in r.json()["detail"]
    assert not ActivityLog.objects.filter(action="system.update").exists()


# ---------------- لاگ داکر ----------------

@pytest.mark.django_db
def test_logs_pass_clean_parameters_to_control(fake):
    c, _ = as_user(Role.OWNER)
    assert c.get("/api/settings/system/logs?service=backend&tail=99999&since=10m").status_code == 200
    _, _, kw = fake.calls[-1]
    assert kw["params"] == {"service": "backend", "tail": 2000, "since": "10m"}
    c.get("/api/settings/system/logs?service=db&tail=abc")
    assert fake.calls[-1][2]["params"]["tail"] == 300


@pytest.mark.django_db
@pytest.mark.parametrize("qs", ["service=", "service=../etc", "service=a b", "service=BACKEND", "service=backend&since=1d", "service=backend&since=$(id)"])
def test_logs_refuse_odd_parameters(fake, qs):
    c, _ = as_user(Role.OWNER)
    assert c.get(f"/api/settings/system/logs?{qs}").status_code == 400
    assert fake.calls == []


# ---------- ایجنت روی همین سرور ----------

def agent_status(**over):
    agent = {
        "name": "asandesk-agent", "state": "running", "project": "asandesk-agent", "workdir": "/srv/Asan-desk-agent",
        "check": {"checked_at": "2026-10-20T10:00:00+00:00", "branch": "main", "behind": 3, "ahead": 0, "dirty": False,
                  "commits": [], "disk_version": "2.0.0", "remote_version": "2.1.0"},
        "error": "",
    }
    return {"agents": [{**agent, **over}], "job": None}


@pytest.mark.django_db
def test_agent_update_status_check_and_start(monkeypatch):
    seen = []

    def call(method, path, **kw):
        seen.append((method, path, kw))
        return agent_status()

    monkeypatch.setattr(control, "call", call)
    c, _ = as_user(Role.OWNER, username="boss")
    r = c.get("/api/settings/system/update/agents").json()
    assert r["agents"][0]["available"] is True and r["agents"][0]["disk_version"] == "2.0.0" and r["agents"][0]["remote_version"] == "2.1.0"
    assert c.post("/api/settings/system/update/agents/check").status_code == 200
    r = c.post("/api/settings/system/update/agents/start", {"project": "asandesk-agent"}, format="json")
    assert r.status_code == 202 and ("POST", "/agents/update", {"params": {"project": "asandesk-agent"}}) in seen
    assert ActivityLog.objects.filter(action="system.agent_update").exists()
    assert c.post("/api/settings/system/update/agents/start", {"project": "bad project!"}, format="json").status_code == 400


@pytest.mark.django_db
def test_agent_up_to_date_and_errors_are_reported(monkeypatch):
    monkeypatch.setattr(control, "call", lambda *a, **k: agent_status(check={"checked_at": "2026-10-20T10:00:00+00:00", "branch": "main", "behind": 0, "disk_version": "2.1.0", "remote_version": "2.1.0"}))
    c, _ = as_user(Role.OWNER, username="boss")
    assert c.get("/api/settings/system/update/agents").json()["agents"][0]["available"] is False
    monkeypatch.setattr(control, "call", lambda *a, **k: agent_status(check=None, error="گرفتن تغییرات از GitHub نشد"))
    a = c.get("/api/settings/system/update/agents").json()["agents"][0]
    assert a["available"] is False and "GitHub" in a["error"]


@pytest.mark.django_db
def test_agent_update_is_owner_only_and_survives_a_missing_control(monkeypatch):
    admin, _ = as_user(Role.ADMIN, username="adm")
    assert admin.get("/api/settings/system/update/agents").status_code == 403
    assert admin.post("/api/settings/system/update/agents/start", {"project": "x"}, format="json").status_code == 403

    def down(*a, **k):
        raise ControlError("control بالا نیست", offline=True)

    monkeypatch.setattr(control, "call", down)
    owner, _ = as_user(Role.OWNER, username="boss")
    r = owner.get("/api/settings/system/update/agents").json()
    assert r["control"]["online"] is False and r["agents"] == []
