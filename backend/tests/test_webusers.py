import json

import pytest
from django.core.cache import cache
from django.test import Client

from accounts.models import Role, User
from webusers.models import WEB_ID_MAX, WEB_ID_MIN, WebUser

H = {"HTTP_X_ASAN_WEB": "1"}
SIGNUP = {
    "first_name": "حمید", "last_name": "رضایی", "username": "Hamid_r", "email": "Hamid@Example.com",
    "phone": "۰۹۱۲ ۱۲۳ ۴۵۶۷", "password": "sabz-kooh-2026",
}


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
    assert (u.username, u.email, u.phone) == ("hamid_r", "hamid@example.com", "09121234567")
    assert SIGNUP["password"] not in u.password and u.check_password(SIGNUP["password"])
    assert WEB_ID_MIN <= int(u.web_id) <= WEB_ID_MAX
    me = web.get("/api/web/me").json()["user"]
    assert me["web_id"] == u.web_id and me["full_name"] == "حمید رضایی"


def test_signup_rejects_duplicates_and_bad_fields(web):
    r = post(Client(), "/api/web/auth/register", {**SIGNUP, "phone": "+989121234567", "username": "x", "email": "bad"})
    fields = r.json()["fields"]
    assert r.status_code == 400 and set(fields) >= {"phone", "username", "email"}
    assert WebUser.objects.count() == 1


@pytest.mark.parametrize("ident", ["hamid_r", "HAMID@example.com", "09121234567", "+98 912 123 4567"])
def test_login_with_username_email_or_phone(web, ident):
    c = Client()
    assert post(c, "/api/web/auth/login", {"identifier": ident, "password": SIGNUP["password"]}).status_code == 200
    assert c.get("/api/web/me").status_code == 200
    assert post(Client(), "/api/web/auth/login", {"identifier": ident, "password": "wrong"}).status_code == 400


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
    r = post(Client(), "/api/web/auth/login", {"identifier": "hamid_r", "password": SIGNUP["password"]})
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
