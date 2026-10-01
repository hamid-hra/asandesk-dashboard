import pytest
from rest_framework.test import APIClient

from accounts.models import Role, User
from clients.models import Client, ClientSession


def panel(role=Role.ADMIN):
    user = User.objects.create_user(username=f"c-{role}", password="x-pass-12345", role=role)
    c = APIClient()
    c.force_authenticate(user)
    return c


def anon():
    return APIClient()


SYS = {"id": "123456789", "uuid": "UUID-1", "os": "Windows 11", "version": "2.4.1",
       "hostname": "desk-1", "username": "ali", "cpu": "i5", "memory": "16"}


@pytest.mark.django_db
def test_sysinfo_creates_client_and_display_name():
    r = anon().post("/api/sysinfo", SYS, format="json")
    assert r.status_code == 200 and r.content == b"SYSINFO_UPDATED"
    cl = Client.objects.get(rid="123456789", uuid="UUID-1")
    assert cl.os == "Windows 11" and cl.version == "2.4.1"
    assert cl.display_name == "ali@desk-1"
    assert cl.first_seen and cl.last_seen


@pytest.mark.django_db
def test_sysinfo_without_username_falls_back_to_hostname():
    payload = {k: v for k, v in SYS.items() if k != "username"}
    anon().post("/api/sysinfo", payload, format="json")
    cl = Client.objects.get(rid="123456789")
    assert cl.name == "" and cl.display_name == "desk-1"


@pytest.mark.django_db
def test_location_flag_controls_ip_storage():
    # با loc=False نباید IP ذخیره شود
    anon().post("/api/sysinfo", {**SYS, "loc": False}, format="json",
                HTTP_X_FORWARDED_FOR="8.8.8.8")
    cl = Client.objects.get(rid="123456789")
    assert cl.ip == ""
    # با loc=True ذخیره می‌شود
    anon().post("/api/sysinfo", {**SYS, "loc": True}, format="json",
                HTTP_X_FORWARDED_FOR="8.8.8.8")
    cl.refresh_from_db()
    assert cl.ip == "8.8.8.8"
    # دوباره خاموش: پاک می‌شود
    anon().post("/api/sysinfo", {**SYS, "loc": False}, format="json",
                HTTP_X_FORWARDED_FOR="8.8.8.8")
    cl.refresh_from_db()
    assert cl.ip == ""


@pytest.mark.django_db
def test_audit_opens_and_closes_session():
    anon().post("/api/sysinfo", SYS, format="json")
    base = {"id": "123456789", "uuid": "UUID-1", "conn_id": 7, "session_id": "99"}
    anon().post("/api/audit/conn", {**base, "action": "new", "ip": "10.0.0.2",
                                    "peer": ["987654321", "supporter"], "type": "remote"},
                format="json")
    s = ClientSession.objects.get(conn_id=7, session_id="99")
    assert s.peer_id == "987654321" and s.peer_name == "supporter" and s.ended_at is None
    anon().post("/api/audit/conn", {**base, "action": "close"}, format="json")
    s.refresh_from_db()
    assert s.ended_at is not None


@pytest.mark.django_db
def test_heartbeat_disconnect_when_blocked():
    anon().post("/api/sysinfo", SYS, format="json")
    cl = Client.objects.get(rid="123456789")
    cl.blocked = True
    cl.save()
    r = anon().post("/api/heartbeat", {"id": "123456789", "uuid": "UUID-1", "conns": [3, 4]},
                    format="json")
    assert r.json().get("disconnect") == [3, 4]


@pytest.mark.django_db
def test_force_disconnect_is_one_shot():
    anon().post("/api/sysinfo", SYS, format="json")
    cl = Client.objects.get(rid="123456789")
    cl.force_disconnect = True
    cl.last_conns = [5]
    cl.save()
    r1 = anon().post("/api/heartbeat", {"id": "123456789", "uuid": "UUID-1"}, format="json")
    assert r1.json().get("disconnect") == [5]
    r2 = anon().post("/api/heartbeat", {"id": "123456789", "uuid": "UUID-1"}, format="json")
    assert "disconnect" not in r2.json()


@pytest.mark.django_db
def test_panel_requires_auth_and_actions():
    anon().post("/api/sysinfo", SYS, format="json")
    cl = Client.objects.get(rid="123456789")
    assert anon().get("/api/clients").status_code == 403
    c = panel(Role.ADMIN)
    rows = c.get("/api/clients").json()
    assert len(rows) == 1 and rows[0]["display_name"] == "ali@desk-1"
    assert c.get(f"/api/clients/{cl.pk}").json()["version"] == "2.4.1"
    assert c.post(f"/api/clients/{cl.pk}/block", {"blocked": True}, format="json").status_code == 200
    cl.refresh_from_db()
    assert cl.blocked is True


@pytest.mark.django_db
def test_viewer_cannot_block():
    anon().post("/api/sysinfo", SYS, format="json")
    cl = Client.objects.get(rid="123456789")
    v = panel(Role.VIEWER)
    assert v.post(f"/api/clients/{cl.pk}/block", {"blocked": True}, format="json").status_code == 403
