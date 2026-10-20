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


@pytest.mark.django_db
def test_release_stats_count_legacy_devices_as_not_up_to_date():
    from releases.models import Release
    Release.objects.create(version="1.4.9", published_on=timezone.localdate(), notes="x", platforms=["Windows"])
    register()  # یک کلاینت فعال روی آخرین نسخه
    Client.objects.bulk_create([Client(rd_id=f"61{i:07d}", legacy=True) for i in range(3)])
    s = panel().get("/api/releases/stats").json()
    assert s["active_devices"] == 4 and s["legacy_devices"] == 3
    assert s["users_on_current"] == 25.0  # ۱ از ۴ دستگاه
    by = {d["version"]: d for d in s["distribution"]}
    assert by["1.4.9"]["share"] == 25.0 and by["قدیمی (بدون API)"]["count"] == 3 and by["قدیمی (بدون API)"]["legacy"] is True


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


# ---------- کلاینت‌های قدیمی (فقط در دیتابیس hbbs) ----------

def peer(rd_id="111222333", uuid="b2xkLTE=", ip="5.6.7.8", created="2025-03-01T10:20:30+00:00"):
    from clients.models import sha256
    return {"id": rd_id, "uuid_hash": sha256(uuid), "ip": ip, "created_at": created}


def peers_post(peers, token="tok"):
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return APIClient().post("/api/agent/peers", {"peers": peers}, format="json", **headers)


@pytest.fixture
def agent_server(db):
    from ha.models import HAServer
    from monitoring.models import Server
    s = Server(name="hbbs-1", first_seen=timezone.now())
    s.set_token("tok")
    s.save()
    HAServer.objects.create(name="hbbs-1", address="10.0.0.9", monitor=s)
    return s


@pytest.mark.django_db
def test_peers_import_creates_legacy_clients_and_is_idempotent(agent_server):
    r = peers_post([peer(), peer("444555666", "b2xkLTI=", "::ffff:9.9.9.9", "2025-04-02T00:00:00+00:00")])
    assert r.status_code == 200 and r.json() == {"created": 2, "updated": 0, "skipped": 0}
    c = Client.objects.get(rd_id="111222333")
    assert c.legacy and c.ip == "5.6.7.8" and c.last_seen is None and not c.online and not c.share_location
    assert c.first_seen.isoformat() == "2025-03-01T10:20:30+00:00" and c.uuid_hash
    assert Client.objects.get(rd_id="444555666").ip == "9.9.9.9"  # ::ffff: برداشته می‌شود

    again = peers_post([peer(ip="1.1.1.1")]).json()
    assert again == {"created": 0, "updated": 1, "skipped": 0}  # IP تازه‌تر ثبت می‌شود
    assert Client.objects.get(rd_id="111222333").ip == "1.1.1.1"
    assert peers_post([peer(ip="1.1.1.1")]).json()["updated"] == 0


@pytest.mark.django_db
def test_peers_endpoint_needs_a_server_token_and_a_valid_body(agent_server):
    assert peers_post([peer()], token=None).status_code == 401
    assert peers_post([peer()], token="wrong").status_code == 401
    assert peers_post([{**peer(), "id": "x"}]).status_code == 400  # شناسهٔ کوتاه
    assert peers_post([{**peer(), "id": "bad id!"}]).status_code == 400
    assert peers_post([{**peer(), "uuid_hash": "nothex"}]).status_code == 400
    assert peers_post([peer(f"1000{i:05d}") for i in range(1001)]).status_code == 400
    assert not Client.objects.exists()


@pytest.mark.django_db
def test_peers_never_change_a_client_that_reports_through_the_api(agent_server):
    app_post("/api/heartbeat", DEV)
    before = Client.objects.get(rd_id=DEV["id"])
    assert not before.legacy and before.ip == ""
    r = peers_post([peer(DEV["id"], "other", "7.7.7.7")])
    assert r.json() == {"created": 0, "updated": 0, "skipped": 1}
    after = Client.objects.get(rd_id=DEV["id"])
    assert after.ip == "" and after.uuid_hash == before.uuid_hash and after.first_seen == before.first_seen


@pytest.mark.django_db
def test_legacy_client_becomes_regular_when_the_device_reports(agent_server):
    created = "2024-01-02T03:04:05+00:00"
    peers_post([peer(DEV["id"], DEV["uuid"], "5.6.7.8", created)])
    assert Client.objects.get(rd_id=DEV["id"]).legacy

    # uuid دیگر → رد می‌شود و ردیف قدیمی می‌ماند (ادعای ردیف قدیمی ممکن نیست)
    assert app_post("/api/heartbeat", {"id": DEV["id"], "uuid": "attacker"}).status_code == 401
    assert Client.objects.get(rd_id=DEV["id"]).legacy

    assert app_post("/api/heartbeat", DEV).status_code == 200
    c = Client.objects.get(rd_id=DEV["id"])
    assert not c.legacy and c.online and Client.objects.count() == 1
    assert c.first_seen.isoformat() == created  # تاریخ اولین ثبت‌نام از دست نمی‌رود


@pytest.mark.django_db
def test_legacy_ip_is_wiped_when_the_upgraded_client_turns_location_off(agent_server):
    peers_post([peer(DEV["id"], DEV["uuid"], "5.6.7.8")])
    register(loc=False)
    c = Client.objects.get(rd_id=DEV["id"])
    assert not c.legacy and c.ip == ""


@pytest.mark.django_db
def test_peer_of_a_blocked_machine_is_created_blocked(agent_server):
    Client.objects.create(rd_id="900000001", uuid_hash=peer()["uuid_hash"], blocked=True)
    peers_post([peer("900000002")])  # همان uuid، شناسهٔ تازه
    assert Client.objects.get(rd_id="900000002").blocked


@pytest.mark.django_db
def test_legacy_clients_are_listed_counted_and_filterable(agent_server):
    peers_post([peer("111222333", ip="5.6.7.8"), peer("444555666", "b3RoZXI=", "8.8.4.4", "2025-05-01T00:00:00+00:00")])
    app_post("/api/heartbeat", DEV)
    c = panel(Role.VIEWER)

    st = c.get("/api/clients/stats").json()
    assert st["total"] == 3 and st["legacy"] == 2
    assert st["online"] == 1  # وضعیت قدیمی‌ها نامشخص است و آنلاین حساب نمی‌شود

    allrows = c.get("/api/clients").json()
    assert allrows["count"] == 3 and allrows["results"][0]["id"] == DEV["id"]  # آنلاین اول
    legacy = c.get("/api/clients?filter=legacy").json()
    assert {r["id"] for r in legacy["results"]} == {"111222333", "444555666"}
    assert all(r["legacy"] and not r["online"] for r in legacy["results"])
    assert {r["ip"] for r in legacy["results"]} == {"5.6.7.8", "8.8.4.4"}
    assert c.get("/api/clients?filter=online").json()["count"] == 1
    assert c.get("/api/clients?q=8.8.4").json()["count"] == 1  # جست‌وجو با IP

    # فیلتر ستون «کلاینت»: فقط قدیمی‌ها / فقط دستگاه‌هایی که به API گزارش می‌دهند
    assert {r["id"] for r in c.get("/api/clients?legacy=only").json()["results"]} == {"111222333", "444555666"}
    assert [r["id"] for r in c.get("/api/clients?legacy=exclude").json()["results"]] == [DEV["id"]]
    # وضعیت قدیمی‌ها نامشخص است: نه آفلاین حساب می‌شوند و نه «غیرفعال بیش از ۳۰ روز»
    assert c.get("/api/clients?status=offline").json()["count"] == 0
    assert c.get("/api/clients?seen=inactive").json()["count"] == 0

    detail = c.get("/api/clients/111222333").json()
    assert detail["legacy"] and detail["ip"] == "5.6.7.8" and not detail["online"]


@pytest.mark.django_db
def test_legacy_client_cannot_be_blocked_or_logged_out(agent_server):
    peers_post([peer()])
    c = panel(Role.ADMIN)
    assert c.post("/api/clients/111222333/block", {"blocked": True}, format="json").status_code == 400
    assert c.post("/api/clients/111222333/logout").status_code == 400
    assert not Client.objects.get(rd_id="111222333").blocked


# ---------- فهرستِ بزرگ: همه‌چیز در SQL و فقط یک صفحه خوانده می‌شود ----------

@pytest.mark.django_db
def test_big_list_pages_cover_every_row_once_for_every_sort(agent_server, django_assert_max_num_queries):
    from clients.models import ConnSession, Ticket
    from clients.stats import SORT_DEFAULT_DIR

    peers_post([peer(f"6100{i:05d}", f"dXVpZC{i}", f"5.0.0.{i % 250}", f"2025-0{1 + i % 9}-1{i % 9} 10:00:00+00:00") for i in range(70)])
    acc = Account.objects.create(email="zed@x.y", name="Zed")
    now = timezone.now()
    for i, ver in enumerate(["1.4.9.1", "1.4.10.2", "1.5.0", "1.4.9"]):
        c = Client.objects.create(rd_id=f"7000{i}", hostname=f"host{i}", os="windows / 11", version=ver, last_seen=now,
                                  first_seen=now - timedelta(days=i), account=acc if i == 0 else None)
        Ticket.objects.create(client=c, subject="x") if i < 2 else None
        ConnSession.objects.create(client=c, conn_id=i, peer_id="9", started_at=now, authorized_at=now - timedelta(minutes=10 * (i + 1)), ended_at=now)
    total = Client.objects.count()
    c = panel(Role.VIEWER)
    for sort in SORT_DEFAULT_DIR:
        for direction in ("asc", "desc"):
            seen = []
            for page in (1, 2, 3):
                r = c.get(f"/api/clients?sort={sort}&dir={direction}&page={page}&page_size=25").json()
                assert r["count"] == total and r["pages"] == 3
                seen += [row["id"] for row in r["results"]]
            assert len(seen) == total and len(set(seen)) == total, (sort, direction)
    # ترتیب نسخه عددی است: 1.4.10.2 بعد از 1.4.9.1
    vs = [r["version"] for r in c.get("/api/clients?sort=version&dir=desc&page_size=10").json()["results"][:4]]
    assert vs == ["1.5.0", "1.4.10.2", "1.4.9.1", "1.4.9"]
    # مرتب‌سازی با مدت اتصال: بیشترین اول
    assert c.get("/api/clients?sort=mins&dir=desc&page_size=10").json()["results"][0]["id"] == "70003"
    # تعداد query به اندازهٔ ردیف‌ها بالا نمی‌رود
    with django_assert_max_num_queries(30):
        c.get("/api/clients?sort=name&page_size=100")


# ---------- وضعیت آنلاین دستگاه‌های قدیمی (حالت شنود ایجنت) ----------

def online_post(ids, token="tok"):
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return APIClient().post("/api/agent/online", {"ids": ids}, format="json", **headers)


@pytest.mark.django_db
def test_online_report_marks_only_legacy_devices_and_makes_their_status_known(agent_server):
    peers_post([peer("111222333"), peer("444555666", "b3RoZXI=", "8.8.4.4")])
    register()  # کلاینت جدید با سیستم‌عامل ویندوز
    c = panel(Role.VIEWER)

    # بدون شنود وضعیت قدیمی‌ها نامشخص است
    rows = {r["id"]: r for r in c.get("/api/clients").json()["results"]}
    assert not rows["111222333"]["status_known"] and rows[DEV["id"]]["status_known"]
    assert c.get("/api/clients/stats").json()["legacy_status_known"] is False

    assert online_post(["111222333", DEV["id"], "999999999"]).json() == {"online": 1}  # فقط یک ردیف قدیمیِ شناخته‌شده
    rows = {r["id"]: r for r in c.get("/api/clients").json()["results"]}
    assert rows["111222333"]["online"] and rows["111222333"]["status_known"]
    assert not rows["444555666"]["online"] and rows["444555666"]["status_known"]  # دیده نشد → آفلاین
    st = c.get("/api/clients/stats").json()
    assert st["legacy_status_known"] is True and st["online_legacy"] == 1
    # حالا قدیمیِ دیده‌نشده آفلاین حساب می‌شود
    assert {r["id"] for r in c.get("/api/clients?status=offline").json()["results"]} == {"444555666"}
    assert c.get("/api/clients/111222333").json()["status_known"] is True
    # توزیع آنلاین‌ها به تفکیک پلتفرم: ویندوزِ API و یک «نامشخص» (قدیمی)
    bd = c.get("/api/monitoring/overview").json()["breakdown"]
    assert bd["total"] == 2 and bd["legacy_known"] is True and dict(map(tuple, bd["platform"])) == {"Windows": 1, "نامشخص": 1}


@pytest.mark.django_db
def test_online_report_needs_a_token_and_valid_ids(agent_server):
    assert online_post(["111222333"], token=None).status_code == 401
    assert online_post(["111222333"], token="wrong").status_code == 401
    assert online_post(["bad id!"]).status_code == 400
    assert online_post([]).status_code == 200  # گزارش خالی هم یعنی «شنود زنده است، کسی آنلاین نیست»
    assert panel().get("/api/clients/stats").json()["legacy_status_known"] is True


@pytest.mark.django_db
def test_legacy_status_goes_back_to_unknown_when_the_agent_stops_reporting(agent_server):
    from monitoring.models import Server

    peers_post([peer()])
    online_post([])
    Server.objects.filter(pk=agent_server.pk).update(peers_online_at=timezone.now() - timedelta(minutes=10))
    assert panel().get("/api/clients/stats").json()["legacy_status_known"] is False
