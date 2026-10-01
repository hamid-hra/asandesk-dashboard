import json
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from clients.models import Account, Client, ConnSession, Ticket, TicketStatus


@pytest.fixture(autouse=True)
def isolate(tmp_path, settings):
    settings.RELEASES_ROOT = tmp_path
    settings.MEDIA_ROOT = tmp_path


def panel(role=Role.ADMIN):
    user, _ = User.objects.get_or_create(username=f"p-{role}", defaults={"role": role})
    c = APIClient()
    c.force_authenticate(user)
    return c


def app_post(path, body, token=None, raw=False):
    """مثل کلاینت آسان‌دسک: بدنه JSON، گاهی بدون Content-Type."""
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return APIClient().generic("POST", path, json.dumps(body), content_type="text/plain" if raw else "application/json", **headers)


DEV = {"id": "482913557", "uuid": "dXVpZC0x"}


def register(dev=DEV, **sysinfo):
    info = {"hostname": "DESKTOP-7H2KQ", "os": "windows / Windows 11 Pro - 22631", "version": "1.4.9",
            "username": "ali", "cpu": "i7, 8/4 cores", "memory": "16GB", **dev, **sysinfo}
    return app_post("/api/sysinfo", info)


# ---------- API اپلیکیشن ----------

@pytest.mark.django_db
def test_heartbeat_registers_device_and_requests_sysinfo():
    r = app_post("/api/heartbeat", {**DEV, "ver": 1004009, "modified_at": 0})
    assert r.status_code == 200 and r.json()["sysinfo"] is True
    c = Client.objects.get(rd_id=DEV["id"])
    assert c.online and c.uuid_hash

    r = register()
    assert r.status_code == 200 and r.content == b"SYSINFO_UPDATED"
    c.refresh_from_db()
    assert c.platform == "Windows" and c.version == "1.4.9" and c.hostname == "DESKTOP-7H2KQ"
    assert "sysinfo" not in app_post("/api/heartbeat", DEV).json()


@pytest.mark.django_db
def test_uuid_mismatch_is_rejected_until_reset():
    register()
    assert app_post("/api/heartbeat", {"id": DEV["id"], "uuid": "other"}).status_code == 401
    assert register(dev={"id": DEV["id"], "uuid": "other"}).content == b"ID_NOT_FOUND"
    Client.objects.filter(rd_id=DEV["id"]).update(uuid_hash="")
    assert app_post("/api/heartbeat", {"id": DEV["id"], "uuid": "other"}).status_code == 200


@pytest.mark.django_db
def test_conn_audit_lifecycle_and_heartbeat_close():
    register()
    register(dev={"id": "130557204", "uuid": "b"}, hostname="MAC")
    app_post("/api/audit/conn", {**DEV, "conn_id": 7, "session_id": 99, "ip": "5.1.2.3", "action": "new"})
    app_post("/api/audit/conn", {**DEV, "conn_id": 7, "session_id": 99, "peer": ["130557204", "MAC"], "type": 0})
    s = ConnSession.objects.get()
    assert s.peer_id == "130557204" and s.authorized_at and s.ended_at is None and s.ip == "5.1.2.3"

    # هنوز در conns → باز می‌ماند؛ بعد از حذف از conns بسته می‌شود
    ConnSession.objects.update(started_at=timezone.now() - timedelta(minutes=5),
                               authorized_at=timezone.now() - timedelta(minutes=5))
    app_post("/api/heartbeat", {**DEV, "conns": [7]})
    assert ConnSession.objects.get().ended_at is None
    app_post("/api/heartbeat", DEV)
    assert ConnSession.objects.get().ended_at is not None

    # مدت اتصال برای هر دو طرف شمرده می‌شود
    rows = {r["id"]: r for r in panel().get("/api/clients").json()["results"]}
    assert rows["482913557"]["mins_30d"] == 5 and rows["130557204"]["sessions_30d"] == 1
    d = panel(Role.VIEWER).get("/api/clients/130557204").json()
    assert d["sessions"][0]["outgoing"] is True and d["sessions"][0]["peer"] == "482913557"
    assert round(sum(d["daily"])) == 5


@pytest.mark.django_db
def test_blocked_client_gets_disconnect():
    register()
    Client.objects.update(blocked=True)
    assert app_post("/api/heartbeat", {**DEV, "conns": [3, 4]}).json()["disconnect"] == [3, 4]


@pytest.mark.django_db
def test_login_current_user_and_forced_logout():
    acc = Account(email="sara@example.com", name="سارا", plan="pro")
    acc.set_password("pass-12345")
    acc.save()
    register()
    bad = app_post("/api/login", {"username": "sara@example.com", "password": "nope", **DEV}, raw=True)
    assert "error" in bad.json()
    r = app_post("/api/login", {"username": "SARA@example.com", "password": "pass-12345", **DEV, "type": "account"}, raw=True)
    body = r.json()
    assert body["type"] == "access_token" and body["user"]["display_name"] == "سارا"
    token = body["access_token"]
    assert app_post("/api/currentUser", DEV, token=token).status_code == 200
    assert Client.objects.get().account == acc

    row = panel().get("/api/clients?filter=logged").json()["results"]
    assert row[0]["logged"] and row[0]["plan"] == "pro" and row[0]["display"] == "سارا"

    assert panel(Role.VIEWER).post(f"/api/clients/{DEV['id']}/logout").status_code == 403
    assert panel().post(f"/api/clients/{DEV['id']}/logout").status_code == 204
    assert app_post("/api/currentUser", DEV, token=token).status_code == 401
    assert Client.objects.get().account is None


@pytest.mark.django_db
def test_client_ticket_flow():
    register()
    r = app_post("/api/client/tickets/new", {**DEV, "subject": "قطع اتصال", "text": "بعد از ۵ دقیقه قطع می‌شود",
                                             "category": "اتصال", "priority": "high"})
    assert r.status_code == 201
    t = Ticket.objects.get()
    assert t.code == f"T-{1000 + t.pk}" and t.diag == "v1.4.9 · windows / Windows 11 Pro - 22631"

    admin = panel()
    assert admin.get("/api/monitoring/status").json()["open_tickets"] == 1
    assert admin.get(f"/api/tickets?q={t.code}").json()[0]["id"] == t.pk
    r = admin.post(f"/api/tickets/{t.pk}/reply", {"text": "لاگ بفرستید"}, format="json")
    assert r.json()["status"] == "pending" and r.json()["messages"][-1]["from_client"] is False
    t.refresh_from_db()
    assert t.first_response_at is not None

    # پاسخ کاربر تیکت را باز می‌کند
    app_post(f"/api/client/tickets/{t.pk}/reply", {**DEV, "text": "فرستادم"})
    assert Ticket.objects.get().status == TicketStatus.OPEN
    listed = app_post("/api/client/tickets/list", DEV).json()["tickets"]
    assert len(listed[0]["messages"]) == 3

    r = admin.post(f"/api/tickets/{t.pk}/reply", {"text": "رفع شد", "close": True}, format="json")
    assert r.json()["status"] == "closed"
    st = admin.get("/api/tickets/stats").json()
    assert st["resolved_7d"] == 1 and st["resolved_fast_share"] == 100 and st["open"] == 0

    assert admin.patch(f"/api/tickets/{t.pk}", {"status": "bogus"}, format="json").status_code == 400
    assert admin.patch(f"/api/tickets/{t.pk}", {"status": "open"}, format="json").json()["status"] == "open"


@pytest.mark.django_db
def test_other_device_cannot_read_tickets():
    register()
    register(dev={"id": "999", "uuid": "z"})
    app_post("/api/client/tickets/new", {**DEV, "subject": "s", "text": "t"})
    t = Ticket.objects.get()
    assert app_post("/api/client/tickets/list", {"id": "999", "uuid": "z"}).json()["tickets"] == []
    assert app_post(f"/api/client/tickets/{t.pk}/reply", {"id": "999", "uuid": "z", "text": "x"}).status_code == 404


@pytest.mark.django_db
def test_block_and_message_from_panel():
    register()
    admin = panel()
    assert admin.post(f"/api/clients/{DEV['id']}/block", {"blocked": True}, format="json").json()["blocked"]
    assert app_post("/api/client/tickets/new", {**DEV, "subject": "s", "text": "t"}).status_code == 403
    r = admin.post(f"/api/clients/{DEV['id']}/message", {"subject": "اطلاعیه", "text": "سلام"}, format="json")
    assert r.status_code == 201 and r.json()["status"] == "pending"
    stats = admin.get("/api/clients/stats").json()
    assert stats["total"] == 1 and stats["online"] == 1 and stats["platforms"][0][0] == "Windows"


@pytest.mark.django_db
def test_release_stats_use_client_versions():
    from releases.models import Release
    Release.objects.create(version="1.4.9", published_on=timezone.localdate(), notes="x", platforms=["Windows"])
    register()
    register(dev={"id": "2", "uuid": "b"}, version="1.4.8")
    s = panel().get("/api/releases/stats").json()
    assert s["users_on_current"] == 50.0
    assert {d["version"] for d in s["distribution"]} == {"1.4.9", "1.4.8"}
    rows = {r["id"]: r for r in panel().get("/api/clients").json()["results"]}
    assert rows["2"]["version_old"] and not rows[DEV["id"]]["version_old"]
