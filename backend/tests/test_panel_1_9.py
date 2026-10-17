"""Panel 1.9: contact info of panel users, two-step recovery, notices, client filters, search, merged logs."""

import json
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.test import Client
from django.utils import timezone

from accounts import contact, recovery
from accounts.models import Role, User
from clients.models import Client as Device
from config.version import VERSION
from notices.models import Notice, NoticeRead
from ops import views as ops_views

PASSWORD = "old-pass-12345"


@pytest.fixture(autouse=True)
def _fresh_throttle():
    cache.clear()
    yield
    cache.clear()


def make(username, role=Role.ADMIN, **kw):
    u = User.objects.create_user(username=username, password=PASSWORD, role=role, **kw)
    User.objects.filter(pk=u.pk).update(date_joined=timezone.now() - timedelta(days=30))
    u.refresh_from_db()
    return u


def signed_in(user):
    c = Client()
    assert c.login(username=user.username, password=PASSWORD)
    return c


def send(c, method, path, body=None):
    return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json")


# ---------------------------------------------------------------- contact info

@pytest.mark.parametrize(
    "raw,out",
    [
        ("09123456789", "09123456789"),
        ("۰۹۱۲۳۴۵۶۷۸۹", "09123456789"),
        ("+98 912 345 6789", "09123456789"),
        ("0098-912-345-6789", "09123456789"),
        ("9123456789", "09123456789"),
        ("+49 151 23456789", "+4915123456789"),
    ],
)
def test_phone_normalizing(raw, out):
    assert contact.normalize_phone(raw) == out


@pytest.mark.django_db
def test_me_reports_missing_contact_and_profile_requires_both():
    u = make("sara")
    c = signed_in(u)
    assert c.get("/api/auth/me").json()["needs_contact"] is True
    r = send(c, "patch", "/api/auth/profile", {"email": "sara@example.com", "phone": ""})
    assert r.status_code == 400 and "phone" in r.json()
    r = send(c, "patch", "/api/auth/profile", {"email": "not-an-email", "phone": "0912"})
    assert r.status_code == 400 and set(r.json()) == {"email", "phone"}
    r = send(c, "patch", "/api/auth/profile", {"email": " Sara@Example.com ", "phone": "+98 912 000 1111"})
    assert r.status_code == 200
    body = r.json()
    assert body["needs_contact"] is False and body["email"] == "sara@example.com" and body["phone"] == "09120001111"


@pytest.mark.django_db
def test_contact_must_be_unique():
    make("ali", email="ali@example.com", phone="09121111111")
    c = signed_in(make("sara"))
    r = send(c, "patch", "/api/auth/profile", {"email": "ALI@example.com", "phone": "09121111111"})
    assert r.status_code == 400
    assert set(r.json()) == {"email", "phone"}


@pytest.mark.django_db
def test_owner_creates_user_with_optional_contact():
    owner = make("boss", Role.OWNER)
    c = signed_in(owner)
    base = {"display_name": "سارا", "password": "temp-pass-9876", "role": "viewer"}
    r = send(c, "post", "/api/settings/users", {**base, "username": "sara"})
    assert r.status_code == 201 and r.json()["needs_contact"] is True
    r = send(c, "post", "/api/settings/users", {**base, "username": "reza", "phone": "123"})
    assert r.status_code == 400 and "phone" in r.json()
    r = send(c, "post", "/api/settings/users", {**base, "username": "reza", "phone": "09351234567", "email": "reza@example.com"})
    assert r.status_code == 201 and r.json()["phone"] == "09351234567" and r.json()["needs_contact"] is False


# ---------------------------------------------------------------- recovery in two steps

@pytest.mark.django_db
def test_recovery_verify_does_not_spend_the_code():
    u = make("sara")
    code = recovery.generate_for(u)[0]
    c = Client()
    assert send(c, "post", "/api/auth/recovery/verify", {"username": "sara", "code": "WRONG-CODE-1234"}).status_code == 400
    assert send(c, "post", "/api/auth/recovery/verify", {"username": "nobody", "code": code}).status_code == 400
    assert send(c, "post", "/api/auth/recovery/verify", {"username": "sara", "code": code}).status_code == 200
    assert recovery.remaining(u) == recovery.COUNT
    r = send(c, "post", "/api/auth/recovery/reset", {"username": "sara", "code": code, "password": "brand-new-pass-678"})
    assert r.status_code == 200
    assert recovery.remaining(u) == recovery.COUNT - 1


# ---------------------------------------------------------------- notices

@pytest.mark.django_db
def test_version_notice_is_created_once_and_shown_until_read():
    u = make("sara")
    c = signed_in(u)
    inbox = c.get("/api/notices").json()
    assert inbox["unread"] == 1
    first = inbox["results"][0]
    assert first["version"] == VERSION and first["kind"] == "update" and first["items"]
    c.get("/api/notices")
    assert Notice.objects.filter(version=VERSION).count() == 1
    assert send(c, "post", f"/api/notices/{first['id']}/read").status_code == 200
    assert c.get("/api/notices").json()["unread"] == 0


@pytest.mark.django_db
def test_version_notice_on_a_fresh_install_starts_read():
    u = User.objects.create_user(username="first", password=PASSWORD, role=Role.OWNER)
    c = signed_in(u)
    assert c.get("/api/notices").json()["unread"] == 0


@pytest.mark.django_db
def test_sending_a_notice_to_selected_users():
    owner = make("boss", Role.OWNER)
    sara, reza = make("sara"), make("reza", Role.VIEWER)
    oc = signed_in(owner)
    oc.get("/api/notices")  # version notice
    r = send(oc, "post", "/api/settings/notices", {"title": "جلسه", "body": "ساعت ۱۰", "recipients": [sara.pk], "kind": "info", "expires_days": "7"})
    assert r.status_code == 201
    nid = r.json()["id"]
    assert r.json()["audience"] == 1
    assert r.json()["reads"] == 0  # the sender is not a recipient, so not counted
    sara_ids = [n["id"] for n in signed_in(sara).get("/api/notices").json()["results"]]
    reza_ids = [n["id"] for n in signed_in(reza).get("/api/notices").json()["results"]]
    assert nid in sara_ids and nid not in reza_ids
    # the sender has it as read
    assert all(n["read"] for n in oc.get("/api/notices").json()["results"] if n["id"] == nid)
    rows = oc.get("/api/settings/notices").json()
    assert any(row["id"] == nid and row["recipient_names"] for row in rows)


@pytest.mark.django_db
def test_only_user_managers_send_notices():
    viewer = make("reza", Role.VIEWER)
    c = signed_in(viewer)
    assert send(c, "post", "/api/settings/notices", {"title": "x"}).status_code == 403
    assert c.get("/api/notices").status_code == 200


@pytest.mark.django_db
def test_new_user_does_not_get_older_notices():
    owner = make("boss", Role.OWNER)
    oc = signed_in(owner)
    send(oc, "post", "/api/settings/notices", {"title": "قدیمی"})
    late = User.objects.create_user(username="late", password=PASSWORD, role=Role.VIEWER)
    titles = [n["title"] for n in signed_in(late).get("/api/notices").json()["results"]]
    assert "قدیمی" not in titles


# ---------------------------------------------------------------- client filters

@pytest.mark.django_db
def test_client_filters_by_platform_os_and_version():
    now = timezone.now()
    Device.objects.create(rd_id="111111111", os="Windows 11 Pro", version="1.4.9.3", last_seen=now)
    Device.objects.create(rd_id="222222222", os="Windows 10 Home", version="1.4.9.2", last_seen=now - timedelta(days=3))
    Device.objects.create(rd_id="333333333", os="Linux / Debian 13", version="1.4.9.3", last_seen=now - timedelta(days=60))
    c = signed_in(make("boss", Role.OWNER))
    ids = lambda q: sorted(r["id"] for r in c.get(f"/api/clients?{q}").json()["results"])  # noqa: E731
    assert ids("platform=Windows") == ["111111111", "222222222"]
    assert ids("os=Windows+10+Home") == ["222222222"]
    assert ids("version=1.4.9.3") == ["111111111", "333333333"]
    assert ids("seen=24h") == ["111111111"]
    assert ids("seen=inactive") == ["333333333"]
    facets = c.get("/api/clients?platform=Windows").json()["facets"]
    # the platform menu still offers Linux, the version menu only Windows versions
    assert dict(facets["platforms"]) == {"Windows": 2, "Linux": 1}
    assert [v for v, _ in facets["versions"]] == ["1.4.9.3", "1.4.9.2"]


# ---------------------------------------------------------------- search

@pytest.mark.django_db
def test_search_respects_sections():
    Device.objects.create(rd_id="482913557", hostname="sara-laptop", last_seen=timezone.now())
    make("sara.ahmadi", email="sara@example.com")
    owner = signed_in(make("boss", Role.OWNER))
    groups = {g["id"]: g for g in owner.get("/api/search?q=sara").json()["groups"]}
    assert "clients" in groups and "users" in groups
    viewer = signed_in(make("reza", Role.VIEWER))
    groups = {g["id"] for g in viewer.get("/api/search?q=sara").json()["groups"]}
    assert "clients" in groups and "users" not in groups
    assert owner.get("/api/search?q=۴۸۲").json()["groups"][0]["items"][0]["id"] == "482913557"


# ---------------------------------------------------------------- docker logs, all services

@pytest.mark.django_db
def test_all_logs_are_merged_by_time(monkeypatch):
    def fake(method, path, params=None, **kw):
        if path == "/services":
            return {"services": [{"service": "backend"}, {"service": "nginx"}, {"service": "update-job"}]}
        lines = {
            "backend": [{"ts": "2026-10-17T10:00:01", "stream": "out", "text": "b1"}, {"ts": "2026-10-17T10:00:03", "stream": "out", "text": "b2"}],
            "nginx": [{"ts": "2026-10-17T10:00:02", "stream": "out", "text": "n1"}],
        }[params["service"]]
        return {"lines": lines}

    monkeypatch.setattr(ops_views.control, "call", fake)
    c = signed_in(make("boss", Role.OWNER))
    body = c.get("/api/settings/system/logs?service=all&tail=100").json()
    assert [(x["service"], x["text"]) for x in body["lines"]] == [("backend", "b1"), ("nginx", "n1"), ("backend", "b2")]
