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
def test_ip_stored_only_with_location_permission():
    ip = {"HTTP_X_REAL_IP": "5.6.7.8"}

    def post(path, body):
        return APIClient().post(path, body, format="json", **ip)

    # دستگاه تازه: تا sysinfo اجازه ندهد IP ثبت نمی‌شود
    post("/api/heartbeat", DEV)
    c = Client.objects.get(rd_id=DEV["id"])
    assert c.ip == ""
    post("/api/sysinfo", {**DEV, "hostname": "h", "loc": False})
    post("/api/heartbeat", DEV)
    c.refresh_from_db()
    assert c.ip == "" and not c.share_location
    # روشن: ثبت می‌شود
    post("/api/sysinfo", {**DEV, "hostname": "h", "loc": True})
    c.refresh_from_db()
    assert c.ip == "5.6.7.8"
    # دوباره خاموش: پاک می‌شود و heartbeat هم دوباره ثبتش نمی‌کند
    post("/api/sysinfo", {**DEV, "hostname": "h", "loc": False})
    post("/api/heartbeat", DEV)
    c.refresh_from_db()
    assert c.ip == ""


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
def test_heartbeat_always_says_whether_the_device_is_blocked():
    # the app removes the server info only on blocked=true and restores it only on an explicit false
    assert app_post("/api/heartbeat", {**DEV, "modified_at": 0}).json()["blocked"] is False
    Client.objects.update(blocked=True)
    assert app_post("/api/heartbeat", DEV).json()["blocked"] is True
    # a wrong uuid gets no "blocked" field at all, so it can never lift a block on the device
    r = app_post("/api/heartbeat", {**DEV, "uuid": "other"})
    assert r.status_code == 401 and "blocked" not in r.json()


@pytest.mark.django_db
def test_block_wipe_is_confirmed_by_the_device_and_reset_on_unblock():
    register()
    admin = panel()
    assert admin.post(f"/api/clients/{DEV['id']}/block", {"blocked": True}, format="json").json()["blocked"]
    d = admin.get(f"/api/clients/{DEV['id']}").json()
    assert d["blocked"] is True and d["revoked_at"] is None  # waiting for the device

    # an ordinary heartbeat does not confirm anything; the blocked device's check does
    app_post("/api/heartbeat", DEV)
    assert admin.get(f"/api/clients/{DEV['id']}").json()["revoked_at"] is None
    assert app_post("/api/heartbeat", {**DEV, "revoked": True}).json()["blocked"] is True
    first = admin.get(f"/api/clients/{DEV['id']}").json()["revoked_at"]
    assert first
    app_post("/api/heartbeat", {**DEV, "revoked": True})
    assert admin.get(f"/api/clients/{DEV['id']}").json()["revoked_at"] == first

    # unblocking tells the device (blocked=false) and clears the confirmation
    assert admin.post(f"/api/clients/{DEV['id']}/block", {"blocked": False}, format="json").json()["blocked"] is False
    assert app_post("/api/heartbeat", {**DEV, "revoked": True}).json()["blocked"] is False
    d = admin.get(f"/api/clients/{DEV['id']}").json()
    assert d["blocked"] is False and d["revoked_at"] is None


@pytest.mark.django_db
def test_a_device_that_says_revoked_while_not_blocked_is_not_marked():
    register()
    app_post("/api/heartbeat", {**DEV, "revoked": True})
    assert Client.objects.get().revoked_at is None


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
def test_blocked_device_cannot_send_feedback_but_panel_stats_work():
    register()
    admin = panel()
    assert admin.post(f"/api/clients/{DEV['id']}/block", {"blocked": True}, format="json").json()["blocked"]
    assert feedback().status_code == 403
    stats = admin.get("/api/clients/stats").json()
    assert stats["total"] == 1 and stats["online"] == 1 and stats["platforms"][0][0] == "Windows"


@pytest.mark.django_db
def test_no_reply_or_message_channel_to_the_user_exists():
    register()
    assert feedback().status_code == 201
    t = Ticket.objects.get()
    admin = panel()
    # the panel cannot write to the user and the app has no ticket list or reply
    assert admin.post(f"/api/tickets/{t.pk}/reply", {"text": "x"}, format="json").status_code == 404
    assert admin.post(f"/api/clients/{DEV['id']}/message", {"subject": "s", "text": "x"}, format="json").status_code == 404
    for path in ("/api/client/tickets/list", "/api/client/tickets/new", f"/api/client/tickets/{t.pk}/reply"):
        assert app_post(path, {**DEV, "subject": "s", "text": "t"}).status_code == 404
    assert t.messages.count() == 1


@pytest.mark.django_db
def test_feedback_has_two_states_and_contacts_come_first():
    register()
    feedback(contact="")
    feedback(contact="09121234567", message="شماره دارم، لطفاً تماس بگیرید")
    admin = panel()
    rows = admin.get("/api/tickets").json()
    assert [bool(r["contact"]) for r in rows] == [True, False]  # the one with a number is on top
    assert admin.get("/api/tickets?contact=1").json()[0]["contact"] == "09121234567"
    assert len(admin.get("/api/tickets?contact=1").json()) == 1
    assert admin.get("/api/tickets?q=0912").json()[0]["contact"] == "09121234567"

    st = admin.get("/api/tickets/stats").json()
    assert st == {"open": 2, "closed": 0, "open_with_contact": 1, "last_7d": 2}

    t = Ticket.objects.get(contact="09121234567")
    assert admin.patch(f"/api/tickets/{t.pk}", {"status": "closed"}, format="json").json()["status"] == "closed"
    assert admin.patch(f"/api/tickets/{t.pk}", {"status": "pending"}, format="json").status_code == 400
    assert admin.patch(f"/api/tickets/{t.pk}", {"status": "bogus"}, format="json").status_code == 400
    st = admin.get("/api/tickets/stats").json()
    assert st["open"] == 1 and st["closed"] == 1 and st["open_with_contact"] == 0
    assert admin.get("/api/monitoring/status").json()["open_tickets"] == 1


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


# ---------- ارسال بازخورد از اپلیکیشن ----------

def gz_b64(text: str | bytes) -> str:
    import base64
    import gzip

    raw = text.encode() if isinstance(text, str) else text
    return base64.b64encode(gzip.compress(raw)).decode()


def feedback(log="INFO boot\nINFO connect ok\n", blob=None, **over):
    body = {**DEV, "category": "bug", "message": "هنگام تمام‌صفحه شدن صفحه تیره می‌شود\nجزئیات بیشتر", "contact": "@ali",
            "version": "1.4.9.5", "os": "windows", "os_version": "10.0.19045", "screen": "1920x1080 @1.25",
            "lang": "fa", "theme": "dark", "log_attached": log is not None, "log_files": ["asandesk_rCURRENT.log"]}
    if log is not None:
        body["log"] = gz_b64(log)
    if blob is not None:  # محتوای خام فیلد log (برای حالت‌های نامعتبر)
        body["log"], body["log_attached"] = blob, True
    body.update(over)
    return app_post("/api/client/feedback", body)


@pytest.mark.django_db
def test_feedback_with_log_is_listed_and_downloadable():
    r = feedback()
    assert r.status_code == 201
    t = Ticket.objects.get()
    assert r.json()["id"] == t.code
    assert t.category == "bug" and t.contact == "@ali" and t.subject == "هنگام تمام‌صفحه شدن صفحه تیره می‌شود"
    assert t.diag == "v1.4.9.5 · windows 10.0.19045 · 1920x1080 @1.25 · fa/dark"
    assert t.messages.get().text.endswith("جزئیات بیشتر") and t.messages.get().from_client
    # دستگاهی که قبلاً heartbeat نفرستاده بود همین‌جا ثبت شده
    assert Client.objects.get(rd_id=DEV["id"]).check_uuid(DEV["uuid"])

    admin = panel()
    row = admin.get("/api/tickets").json()[0]
    assert row["has_log"] is True and row["category"] == "bug"
    d = admin.get(f"/api/tickets/{t.pk}").json()
    assert d["contact"] == "@ali" and d["log"] == {"size": len(b"INFO boot\nINFO connect ok\n"), "files": ["asandesk_rCURRENT.log"]}
    dl = admin.get(f"/api/tickets/{t.pk}/log")
    assert dl.status_code == 200 and b"".join(dl.streaming_content) == b"INFO boot\nINFO connect ok\n"
    assert dl["Content-Disposition"].startswith("attachment") and t.code in dl["Content-Disposition"]
    assert APIClient().get(f"/api/tickets/{t.pk}/log").status_code == 403


@pytest.mark.django_db
def test_feedback_without_log_and_unknown_category():
    assert feedback(log=None, category="weird").status_code == 201
    t = Ticket.objects.get()
    assert t.category == "other" and not t.log_file
    assert panel().get(f"/api/tickets/{t.pk}").json()["log"] is None
    assert panel().get(f"/api/tickets/{t.pk}/log").status_code == 404


@pytest.mark.django_db
def test_feedback_rejects_bad_requests(settings):
    assert feedback(message="کم").status_code == 400
    assert feedback(uuid="").status_code == 401
    assert feedback(log="x" * 10).status_code == 201  # لاگ معتبر است
    assert feedback(blob="!!not base64!!").status_code == 400
    # gzip نیست
    import base64
    assert feedback(blob=base64.b64encode(b"plain text").decode()).status_code == 400
    # فایل فشردهٔ بسیار بزرگ (zip bomb) رد می‌شود
    settings.FEEDBACK_MAX_LOG_BYTES = 1000
    assert feedback(log="a" * 5000).status_code == 413
    # فقط همان یک بازخورد معتبر ثبت شده است
    assert Ticket.objects.count() == 1


@pytest.mark.django_db
def test_feedback_rate_limit_and_block(settings):
    settings.CLIENT_FEEDBACK_PER_HOUR = 2
    assert feedback(log=None).status_code == 201
    assert feedback(log=None).status_code == 201
    assert feedback(log=None).status_code == 429
    settings.CLIENT_FEEDBACK_PER_HOUR = 99
    panel().post(f"/api/clients/{DEV['id']}/block", {"blocked": True}, format="json")
    assert feedback(log=None).status_code == 403


@pytest.mark.django_db
def test_feedback_log_file_is_removed_with_ticket(tmp_path):
    feedback()
    t = Ticket.objects.get()
    path = t.log_file.path
    import os
    assert os.path.exists(path)
    t.delete()
    assert not os.path.exists(path)


# ---------- تصویرهای پیوست بازخورد ----------

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 40


def shot(raw: bytes, name="image-1.jpg", mime="image/jpeg") -> dict:
    import base64

    return {"name": name, "mime": mime, "data": base64.b64encode(raw).decode()}


@pytest.mark.django_db
def test_feedback_with_images_is_stored_listed_and_served():
    r = feedback(log=None, images=[shot(JPG), shot(PNG, "x.png", "image/png")])
    assert r.status_code == 201 and r.json()["images"] == 2
    t = Ticket.objects.get()
    assert t.images.count() == 2

    admin = panel()
    assert admin.get("/api/tickets").json()[0]["image_count"] == 2
    d = admin.get(f"/api/tickets/{t.pk}").json()
    assert d["image_count"] == 2 and [i["mime"] for i in d["images"]] == ["image/jpeg", "image/png"]
    assert [i["size"] for i in d["images"]] == [len(JPG), len(PNG)]

    first = admin.get(f"/api/tickets/{t.pk}/images/{d['images'][0]['id']}")
    assert first.status_code == 200 and first["Content-Type"] == "image/jpeg"
    assert b"".join(first.streaming_content) == JPG
    assert first["X-Content-Type-Options"] == "nosniff"
    # فقط با دسترسی به پنل، و فقط داخل همان بازخورد
    assert APIClient().get(f"/api/tickets/{t.pk}/images/{d['images'][0]['id']}").status_code == 403
    assert admin.get(f"/api/tickets/{t.pk + 1}/images/{d['images'][0]['id']}").status_code == 404


@pytest.mark.django_db
def test_feedback_without_images_has_none():
    assert feedback(log=None).json()["images"] == 0
    t = Ticket.objects.get()
    d = panel().get(f"/api/tickets/{t.pk}").json()
    assert d["images"] == [] and d["image_count"] == 0
    assert panel().get("/api/tickets").json()[0]["image_count"] == 0


@pytest.mark.django_db
def test_feedback_image_type_comes_from_content_not_from_client():
    # کلاینت می‌گوید jpeg است و نام png می‌گذارد؛ محتوا HTML است → رد می‌شود
    html = shot(b"<html><script>alert(1)</script></html>", "a.png", "image/png")
    assert feedback(log=None, images=[html]).status_code == 400
    # محتوای واقعی PNG با mime دروغ: با نوع واقعی ذخیره می‌شود
    assert feedback(log=None, images=[shot(PNG, "a.html", "text/html")]).status_code == 201
    im = Ticket.objects.get().images.get()
    assert im.mime == "image/png" and im.file.name.endswith(".png")


@pytest.mark.django_db
def test_feedback_rejects_bad_images(settings):
    assert feedback(log=None, images=[shot(JPG)] * 4).status_code == 400  # بیشتر از سه تا
    assert feedback(log=None, images="nope").status_code == 400
    assert feedback(log=None, images=["nope"]).status_code == 400
    assert feedback(log=None, images=[{"data": "!!not base64!!"}]).status_code == 400
    assert feedback(log=None, images=[{"name": "x.jpg"}]).status_code == 400
    settings.FEEDBACK_MAX_IMAGE_BYTES = 1000
    assert feedback(log=None, images=[shot(JPG + b"\x00" * 2000)]).status_code == 413
    # هیچ‌کدام بازخورد نساخته‌اند
    assert Ticket.objects.count() == 0


@pytest.mark.django_db
def test_feedback_image_files_are_removed_with_ticket():
    import os

    feedback(log=None, images=[shot(JPG), shot(PNG)])
    t = Ticket.objects.get()
    paths = [i.file.path for i in t.images.all()]
    assert len(paths) == 2 and all(os.path.exists(p) for p in paths)
    t.delete()
    assert not any(os.path.exists(p) for p in paths)
