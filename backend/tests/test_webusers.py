import json

import pytest
from django.core.cache import cache
from django.test import Client

from accounts.models import Role, User
from webusers.models import WEB_ID_MAX, WEB_ID_MIN, WebUser

H = {"HTTP_X_ASAN_WEB": "1"}
SIGNUP = {"identifier": "Hamid@Example.com", "password": "sabz-kooh-2026", "display_name": "حمید رضایی"}


@pytest.fixture(autouse=True)
def _fresh_throttle():
    cache.clear()
    yield
    cache.clear()


def post(c, url, body=None, **extra):
    return c.post(url, json.dumps(body or {}), content_type="application/json", **{**H, **extra})


@pytest.fixture
def web(db):
    c = Client()
    assert post(c, "/api/web/auth/register", SIGNUP).status_code == 200
    return c


def test_signup_stores_a_hash_and_gives_a_web_code(web):
    u = WebUser.objects.get()
    assert (u.email, u.phone, u.display_name) == ("hamid@example.com", None, "حمید رضایی")
    assert SIGNUP["password"] not in u.password and u.check_password(SIGNUP["password"])
    assert WEB_ID_MIN <= int(u.web_id) <= WEB_ID_MAX
    me = web.get("/api/web/me").json()["user"]
    assert me["web_id"] == u.web_id and me["name"] == "حمید رضایی"


def test_signup_with_a_phone_and_no_display_name(db):
    c = Client()
    r = post(c, "/api/web/auth/register", {"identifier": "۰۹۱۲ ۱۲۳ ۴۵۶۷", "password": SIGNUP["password"]})
    assert r.status_code == 200
    u = WebUser.objects.get()
    assert (u.email, u.phone, u.display_name) == (None, "09121234567", "")
    assert r.json()["user"]["name"] == "09121234567"
    # نام نمایشی را بعدا خودش می‌گذارد
    me = c.patch("/api/web/me", json.dumps({"display_name": " حمید  "}), content_type="application/json", **H).json()
    assert me["user"]["name"] == "حمید" and WebUser.objects.get().display_name == "حمید"


def test_signup_rejects_duplicates_and_bad_fields(web):
    r = post(Client(), "/api/web/auth/register", {**SIGNUP, "identifier": "HAMID@example.com"})
    assert r.status_code == 400 and set(r.json()["fields"]) == {"identifier"}
    r = post(Client(), "/api/web/auth/register", {"identifier": "hamid_r", "password": "1", "display_name": "<b>"})
    assert r.status_code == 400 and set(r.json()["fields"]) == {"identifier", "password", "display_name"}
    assert WebUser.objects.count() == 1


@pytest.mark.parametrize("ident", ["HAMID@example.com", "hamid@example.com "])
def test_login_with_email(web, ident):
    c = Client()
    assert post(c, "/api/web/auth/login", {"identifier": ident, "password": SIGNUP["password"]}).status_code == 200
    assert c.get("/api/web/me").status_code == 200
    assert post(Client(), "/api/web/auth/login", {"identifier": ident, "password": "wrong"}).status_code == 400


@pytest.mark.parametrize("ident", ["09121234567", "+98 912 123 4567", "۹۱۲۱۲۳۴۵۶۷"])
def test_login_with_phone(db, ident):
    post(Client(), "/api/web/auth/register", {"identifier": "09121234567", "password": SIGNUP["password"]})
    c = Client()
    assert post(c, "/api/web/auth/login", {"identifier": ident, "password": SIGNUP["password"]}).status_code == 200
    assert post(Client(), "/api/web/auth/login", {"identifier": "hamid_r", "password": SIGNUP["password"]}).status_code == 400


def test_writes_need_the_web_header(db):
    r = Client().post("/api/web/auth/register", json.dumps(SIGNUP), content_type="application/json")
    assert r.status_code == 403 and not WebUser.objects.exists()


def test_blocking_ends_sessions_and_login(web, db):
    owner = User.objects.create_user(username="owner", password="x-pass-12345", role=Role.OWNER)
    panel = Client()
    panel.force_login(owner)
    u = WebUser.objects.get()
    rows = panel.get("/api/webusers").json()["rows"]
    assert [r["web_id"] for r in rows] == [u.web_id]
    assert panel.post(f"/api/webusers/{u.pk}/block", {"blocked": True}, content_type="application/json").status_code == 200
    assert web.get("/api/web/me").status_code == 401
    r = post(Client(), "/api/web/auth/login", {"identifier": "hamid@example.com", "password": SIGNUP["password"]})
    assert r.status_code == 403 and r.json()["code"] == "blocked"


def test_web_session_opens_nothing_in_the_panel(web):
    assert web.get("/api/webusers").status_code in (401, 403)
    assert web.get("/api/clients").status_code in (401, 403)


def test_peer_key_and_devices(web):
    key = web.get("/api/web/me/peer-key", **H).json()
    assert len(key["seed"]) == 44 and key["pk"] == WebUser.objects.get().sign_pk
    post(web, "/api/web/devices", {"peer_id": "123 456 789", "name": "office-pc", "platform": "Windows"})
    post(web, "/api/web/devices", {"peer_id": "123456789"})
    devices = web.get("/api/web/devices").json()["devices"]
    assert [(d["peer_id"], d["name"]) for d in devices] == [("123456789", "office-pc")]


def test_web_user_reports_like_a_client_and_shows_as_web(web):
    from clients.models import Client as Device

    key = web.get("/api/web/me/peer-key", **H).json()
    body = {"id": key["web_id"], "uuid": key["uuid"]}
    rsp = Client().post("/api/heartbeat", json.dumps(body), content_type="application/json").json()
    assert rsp["blocked"] is False and rsp.get("sysinfo") is True
    Client().post("/api/sysinfo", json.dumps({**body, "hostname": "حمید رضایی", "username": "hamid_r",
                                               "os": "AsanDesk Web · Chrome 130 · Windows", "version": "1.5.0.0"}),
                  content_type="application/json")
    device = Device.objects.get(rd_id=key["web_id"])
    assert (device.platform, device.version, device.hostname) == ("Web", "1.5.0.0", "حمید رضایی")


@pytest.mark.django_db(transaction=True)
def test_existing_accounts_keep_their_name_and_login():
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    executor.migrate([("webusers", "0001_initial")])
    old = executor.loader.project_state([("webusers", "0001_initial")]).apps.get_model("webusers", "WebUser")
    old.objects.create(first_name="حمید", last_name="رضایی", username="hamid_r", email="hamid@example.com",
                       phone="09121234567", password="x", web_id="3000000001", peer_uuid="u", sign_seed="s", sign_pk="p")
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
    u = WebUser.objects.get()
    assert (u.display_name, u.email, u.phone, u.web_id) == ("حمید رضایی", "hamid@example.com", "09121234567", "3000000001")
