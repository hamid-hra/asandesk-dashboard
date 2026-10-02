import io
import tarfile

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from backups import service
from backups.models import Backup, BackupSettings, Operation
from ha import checker
from ha.models import HAConfig, HAServer


@pytest.fixture(autouse=True)
def isolate(tmp_path, settings):
    settings.RELEASES_ROOT = tmp_path / "rel"
    settings.MEDIA_ROOT = settings.RELEASES_ROOT
    settings.BACKUPS_ROOT = tmp_path / "bk"
    settings.RELEASES_ROOT.mkdir()


def as_user(role, perms=None, username=None):
    u = User.objects.create_user(username=username or f"u-{role}", password="x-Pass-12345", role=role, perms=perms or {})
    c = APIClient()
    c.force_authenticate(u)
    return c, u


# ---------------- کاربران و دسترسی ----------------

@pytest.mark.django_db
def test_section_permissions_apply_per_role():
    owner, _ = as_user(Role.OWNER, username="o")
    assert owner.get("/api/settings/users").status_code == 200
    admin, _ = as_user(Role.ADMIN, username="a")
    assert admin.get("/api/settings/users").status_code == 403  # users: none
    assert admin.get("/api/settings/backups/").status_code == 200  # backup: view
    assert admin.post("/api/settings/backups/run", {}, format="json").status_code == 403
    viewer, _ = as_user(Role.VIEWER, username="v")
    assert viewer.get("/api/monitoring/overview").status_code == 200
    assert viewer.post("/api/monitoring/alerts/ack-all").status_code == 403


@pytest.mark.django_db
def test_custom_role_levels():
    c, u = as_user(Role.CUSTOM, {"server": "none", "clients": "edit", "backup": "edit"}, username="cu")
    assert c.get("/api/monitoring/overview").status_code == 403
    assert c.get("/api/clients").status_code == 200
    assert c.get("/api/tickets").status_code == 403
    assert u.resolved_perms()["backup"] == "edit"
    assert c.get("/api/auth/me").json()["perms"]["clients"] == "edit"


@pytest.mark.django_db
def test_owner_creates_edits_and_deletes_users():
    c, owner = as_user(Role.OWNER, username="boss")
    r = c.post("/api/settings/users", {"display_name": "سارا", "username": "sara", "password": "Str0ng-pass-99", "role": "admin"}, format="json")
    assert r.status_code == 201 and r.json()["role"] == "admin"
    uid = r.json()["id"]
    assert c.post("/api/settings/users", {"display_name": "x", "username": "SARA", "password": "Str0ng-pass-99", "role": "viewer"}, format="json").status_code == 400
    assert c.post("/api/settings/users", {"display_name": "x", "username": "evil", "password": "Str0ng-pass-99", "role": "owner"}, format="json").status_code == 400
    r = c.patch(f"/api/settings/users/{uid}", {"role": "custom", "perms": {"clients": "edit", "bogus": "edit"}, "active": False}, format="json")
    row = r.json()
    assert r.status_code == 200 and row["role"] == "custom" and row["active"] is False
    assert User.objects.get(pk=uid).perms["clients"] == "edit" and "bogus" not in User.objects.get(pk=uid).perms
    assert c.delete(f"/api/settings/users/{uid}").status_code == 204


@pytest.mark.django_db
def test_owner_is_locked_and_cannot_self_delete():
    c, owner = as_user(Role.OWNER, username="boss")
    assert c.delete(f"/api/settings/users/{owner.pk}").status_code == 400
    assert c.patch(f"/api/settings/users/{owner.pk}", {"role": "viewer"}, format="json").status_code == 400
    assert c.patch(f"/api/settings/users/{owner.pk}", {"active": False}, format="json").status_code == 400


@pytest.mark.django_db
def test_non_owner_cannot_escalate_or_touch_owner():
    c, me = as_user(Role.CUSTOM, {"users": "edit", "clients": "view"}, username="mgr")
    other = User.objects.create_user(username="own", password="p", role=Role.OWNER)
    assert c.patch(f"/api/settings/users/{other.pk}", {"display_name": "x"}, format="json").status_code == 403
    r = c.post("/api/settings/users", {"display_name": "n", "username": "newbie", "password": "Str0ng-pass-99", "role": "admin"}, format="json")
    assert r.status_code == 403  # admin از مدیر سفارشی بیشتر دارد
    r = c.post("/api/settings/users", {"display_name": "n", "username": "newbie", "password": "Str0ng-pass-99", "role": "custom", "perms": {"clients": "view"}}, format="json")
    assert r.status_code == 201


# ---------------- پشتیبان‌گیری ----------------

@pytest.mark.django_db
def test_backup_and_restore_roundtrip():
    c, owner = as_user(Role.OWNER, username="boss")
    User.objects.create_user(username="keepme", password="p", role=Role.VIEWER)
    (settings_root := service.files_root()).joinpath("a").mkdir()
    (settings_root / "a" / "f.bin").write_bytes(b"x" * 1000)

    assert c.post("/api/settings/backups/run", {"include_files": True}, format="json").status_code == 201
    assert c.post("/api/settings/backups/run", {}, format="json").status_code == 409  # عملیات دیگر در جریان
    op = Operation.objects.get()
    service.execute(op)
    op.refresh_from_db()
    assert op.status == Operation.Status.OK and op.pct == 100 and op.logs
    b = Backup.objects.get()
    assert b.ok and b.include_files and b.size > 0

    # تغییر داده، سپس بازگردانی
    User.objects.filter(username="keepme").delete()
    (settings_root / "a" / "f.bin").unlink()
    bad = c.post(f"/api/settings/backups/{b.pk}/restore", {"confirm": "نه"}, format="json")
    assert bad.status_code == 400
    assert c.post(f"/api/settings/backups/{b.pk}/restore", {"confirm": "بازگردانی", "safety": True}, format="json").status_code == 201
    rop = Operation.objects.filter(kind="restore").get()
    service.execute(rop)
    rop.refresh_from_db()
    assert rop.status == Operation.Status.OK, rop.message
    assert User.objects.filter(username="keepme").exists()
    assert (settings_root / "a" / "f.bin").read_bytes() == b"x" * 1000
    assert Backup.objects.filter(kind="safety").exists()


@pytest.mark.django_db
def test_retention_removes_only_old_auto_backups():
    cfg = BackupSettings.get()
    cfg.keep_days = 14
    cfg.save()
    root = service.root()
    for kind, days in (("auto", 20), ("auto", 3), ("manual", 40)):
        name = f"{kind}-{days}.adbk"
        (root / name).write_bytes(b"x")
        Backup.objects.create(kind=kind, created_at=timezone.now() - timezone.timedelta(days=days), filename=name, size=1)
    assert service.enforce_retention() == 1
    assert sorted(Backup.objects.values_list("kind", flat=True)) == ["auto", "manual"]


@pytest.mark.django_db
def test_settings_validation_and_upload_rejects_garbage():
    c, _ = as_user(Role.OWNER, username="boss")
    assert c.patch("/api/settings/backups/settings", {"keep_days": 0}, format="json").status_code == 400
    assert c.patch("/api/settings/backups/settings", {"keep_days": 30, "run_time": "02:30", "enabled": False}, format="json").json()["keep_days"] == 30
    assert BackupSettings.get().run_time.hour == 2
    from django.core.files.uploadedfile import SimpleUploadedFile
    r = c.post("/api/settings/backups/upload", {"file": SimpleUploadedFile("x.adbk", b"not a tar")}, format="multipart")
    assert r.status_code == 400
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for name, data in (("manifest.json", b'{"format":1,"include_files":false}'), ("db.jsonl", b"")):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    r = c.post("/api/settings/backups/upload", {"file": SimpleUploadedFile("ok.adbk", buf.getvalue())}, format="multipart")
    assert r.status_code == 201 and r.json()["kind"] == "uploaded"


@pytest.mark.django_db
def test_cancel_queued_operation():
    c, _ = as_user(Role.OWNER, username="boss")
    op = c.post("/api/settings/backups/run", {}, format="json").json()
    r = c.post(f"/api/settings/backups/operation/{op['id']}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


# ---------------- HA ----------------

@pytest.mark.django_db
def test_ha_add_flow_and_failover(monkeypatch):
    c, _ = as_user(Role.OWNER, username="boss")
    r = c.post("/api/settings/ha/servers", {"name": "t1", "address": "10.0.0.1", "role": "primary"}, format="json")
    assert r.status_code == 201 and r.json()["token"] and "AGENT_TOKEN=" in r.json()["command"]
    s1 = r.json()["server"]["id"]
    assert c.get("/api/settings/ha/").json()["servers"] == []  # پیش‌نویس هنوز نمایش داده نمی‌شود
    assert c.post(f"/api/settings/ha/servers/{s1}/confirm").status_code == 200
    r2 = c.post("/api/settings/ha/servers", {"name": "t2", "address": "10.0.0.2"}, format="json")
    s2 = r2.json()["server"]["id"]
    assert r2.json()["server"]["priority"] == 2

    state = {"10.0.0.1": "ok", "10.0.0.2": "ok"}

    def fake_probe(s):
        st = state[s.address]
        return {"ports": {p[1]: st != "down" for p in checker.port_specs(s)}, "latency": 20 if st != "down" else None, "status": st}

    monkeypatch.setattr(checker, "probe_server", fake_probe)
    assert c.post(f"/api/settings/ha/servers/{s2}/confirm").status_code == 200
    data = c.get("/api/settings/ha/").json()
    assert [s["name"] for s in data["servers"] if s["serving"]] == ["t1"]

    state["10.0.0.1"] = "down"
    for _ in range(HAConfig.get().fails):
        checker.run_checks()
    data = c.get("/api/settings/ha/").json()
    assert data["serving"] == "t2" and data["last_failover"] is not None
    state["10.0.0.1"] = "ok"
    checker.run_checks()
    assert c.get("/api/settings/ha/").json()["serving"] == "t1"  # برگشت خودکار


@pytest.mark.django_db
def test_ha_validation_promote_and_viewer_readonly():
    c, _ = as_user(Role.OWNER, username="boss")
    assert c.post("/api/settings/ha/servers", {"name": "bad name!", "address": "1.2.3.4"}, format="json").status_code == 400
    assert c.post("/api/settings/ha/servers", {"name": "ok", "address": "not valid host!"}, format="json").status_code == 400
    a = c.post("/api/settings/ha/servers", {"name": "a", "address": "10.0.0.1", "role": "primary"}, format="json").json()["server"]["id"]
    b = c.post("/api/settings/ha/servers", {"name": "b", "address": "10.0.0.2"}, format="json").json()["server"]["id"]
    HAServer.objects.update(draft=False)
    assert c.post("/api/settings/ha/servers", {"name": "c", "address": "10.0.0.3", "role": "primary"}, format="json").status_code == 400
    assert c.post(f"/api/settings/ha/servers/{b}/promote").status_code == 200
    assert HAServer.objects.get(pk=b).role == "primary" and HAServer.objects.get(pk=a).role == "backup"
    assert c.patch("/api/settings/ha/config", {"interval": 0}, format="json").status_code == 400
    viewer, _ = as_user(Role.VIEWER, username="v")
    assert viewer.get("/api/settings/ha/").status_code == 200
    assert viewer.post(f"/api/settings/ha/servers/{a}/promote").status_code == 403
    assert a


@pytest.mark.django_db
def test_agentless_ha_server_does_not_count_as_down(monkeypatch):
    from monitoring import stats
    c, _ = as_user(Role.OWNER, username="boss")
    c.post("/api/settings/ha/servers", {"name": "t1", "address": "10.0.0.1", "role": "primary"}, format="json")
    assert stats.live_snapshot()["total"] == 0  # هنوز agent گزارش نداده
