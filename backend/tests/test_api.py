import json
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from monitoring import stats
from monitoring.models import Alert, MetricSample, Server, hash_token
from releases.models import Release, version_key


@pytest.fixture(autouse=True)
def releases_root(tmp_path, settings):
    settings.RELEASES_ROOT = tmp_path
    settings.MEDIA_ROOT = tmp_path
    settings.SECRETS_DIR = tmp_path / "secrets"
    settings.AGENT_TOKEN_FILE = tmp_path / "agent" / "token"
    return tmp_path


def client_for(role):
    user = User.objects.create_user(username=f"u-{role}", password="x-pass-12345", role=role)
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def server():
    s = Server(name="srv-1", region="تهران")
    s.set_token("tok")
    s.save()
    return s


def ingest(payload=None, token="tok", **over):
    data = {"cpu": 10, "ram": 20, "disk": 30, "tcp_established": 5, "cores": 4, "ram_total": 1000}
    data.update(payload or {}, **over)
    c = APIClient()
    return c.post("/api/agent/ingest", data, format="json", HTTP_AUTHORIZATION=f"Bearer {token}")


# ---------- accounts ----------

@pytest.mark.django_db
def test_owner_role_controls_admin_access():
    owner = User.objects.create_user(username="o", password="p", role=Role.OWNER)
    viewer = User.objects.create_user(username="v", password="p", role=Role.VIEWER)
    assert owner.is_staff and owner.is_superuser
    assert not viewer.is_staff and not viewer.is_superuser
    su = User.objects.create_superuser("root", password="p")
    assert su.role == Role.OWNER


@pytest.mark.django_db
def test_login_and_me():
    User.objects.create_user(username="a", password="secret-pass-1", role=Role.ADMIN)
    c = APIClient()
    assert c.get("/api/auth/me").status_code == 403
    bad = c.post("/api/auth/login", {"username": "a", "password": "nope"}, format="json")
    assert bad.status_code == 400
    ok = c.post("/api/auth/login", {"username": "a", "password": "secret-pass-1"}, format="json")
    assert ok.status_code == 200 and ok.json()["role"] == "admin"
    assert c.get("/api/auth/me").json()["can_manage"] is True


@pytest.mark.django_db
def test_anonymous_cannot_read_monitoring():
    assert APIClient().get("/api/monitoring/overview").status_code == 403


# ---------- first-run setup ----------

def setup_post(c, **over):
    data = {"code": code_now(), "username": "boss", "password": "Str0ng-pass-word"}
    data.update(over)
    return c.post("/api/auth/setup", data, format="json")


def code_now():
    from accounts.setup import ensure_setup_code

    return ensure_setup_code()


@pytest.mark.django_db
def test_first_run_setup_creates_owner_and_logs_in():
    c = APIClient()
    assert c.get("/api/auth/setup").json() == {"needed": True}
    code = code_now()
    assert len(code) == 14
    r = setup_post(c, code=code.lower().replace("-", ""))  # حروف کوچک و بدون خط تیره هم پذیرفته می‌شود
    assert r.status_code == 201, r.content
    assert r.json()["role"] == "owner"
    assert c.get("/api/auth/me").status_code == 200
    assert c.get("/api/auth/setup").json() == {"needed": False}
    # کد پس از استفاده حذف می‌شود و راه‌اندازی دوباره ممکن نیست
    from accounts.setup import code_path

    assert not code_path().exists()
    assert APIClient().post("/api/auth/setup", {"code": code, "username": "x", "password": "Str0ng-pass-word"},
                            format="json").status_code == 409


@pytest.mark.django_db
def test_setup_rejects_wrong_code_and_weak_password():
    c = APIClient()
    code_now()
    assert setup_post(c, code="AAAA-BBBB-CCCC").status_code == 400
    weak = setup_post(c, password="123")
    assert weak.status_code == 400 and "password" in weak.json()
    bad_user = setup_post(c, username="کاربر فارسی")
    assert bad_user.status_code == 400 and "username" in bad_user.json()
    assert not User.objects.exists()


@pytest.mark.django_db
def test_bootstrap_generates_agent_token_and_setup_code(settings, capsys):
    from django.core.management import call_command

    call_command("bootstrap")
    token = settings.AGENT_TOKEN_FILE.read_text().strip()
    assert Server.objects.filter(token_hash=hash_token(token)).exists()
    assert "SETUP CODE" in capsys.readouterr().out
    call_command("bootstrap")  # idempotent
    assert Server.objects.count() == 1
    assert settings.AGENT_TOKEN_FILE.read_text().strip() == token


# ---------- monitoring ----------

@pytest.mark.django_db
def test_ingest_requires_valid_token(server):
    assert ingest(token="wrong").status_code == 401
    r = ingest()
    assert r.status_code == 201
    server.refresh_from_db()
    assert server.cores == 4 and server.last_seen is not None
    assert MetricSample.objects.count() == 1
    # اولین گزارش یک رویداد «اتصال سرور» ثبت می‌کند
    assert Alert.objects.filter(kind="connected").count() == 1
    ingest()
    assert Alert.objects.filter(kind="connected").count() == 1


@pytest.mark.django_db
def test_ingest_rejects_out_of_range_values(server):
    assert ingest(cpu=150).status_code == 400


@pytest.mark.django_db
def test_cpu_alert_needs_sustained_load_and_clears(server):
    now = timezone.now()
    for i in range(12):
        MetricSample.objects.create(server=server, ts=now - timedelta(minutes=11 - i), cpu=90, ram=10, disk=10)
    ingest(cpu=92)
    alert = Alert.objects.get(kind="cpu_high")
    assert alert.level == "crit" and alert.resolved_at is None
    MetricSample.objects.filter(server=server).update(cpu=20)
    ingest(cpu=20)
    alert.refresh_from_db()
    assert alert.resolved_at is not None


@pytest.mark.django_db
def test_short_cpu_spike_does_not_alert(server):
    ingest(cpu=99)
    assert not Alert.objects.filter(kind="cpu_high").exists()


@pytest.mark.django_db
def test_disk_and_ram_alerts(server):
    ingest(disk=96, ram=95)
    assert Alert.objects.get(kind="disk_high").level == "crit"
    assert Alert.objects.get(kind="ram_high").level == "warn"
    ingest(disk=50, ram=40)
    assert not Alert.objects.filter(resolved_at__isnull=True, kind__in=["disk_high", "ram_high"]).exists()


@pytest.mark.django_db
def test_offline_server_alert(server):
    ingest()
    Server.objects.filter(pk=server.pk).update(last_seen=timezone.now() - timedelta(minutes=10))
    c = client_for(Role.VIEWER)
    c.get("/api/monitoring/status")
    assert Alert.objects.filter(kind="offline", resolved_at__isnull=True).exists()
    ingest()
    assert not Alert.objects.filter(kind="offline", resolved_at__isnull=True).exists()


@pytest.mark.django_db
def test_overview_buckets(server):
    now = timezone.now()
    MetricSample.objects.create(server=server, ts=now - timedelta(minutes=1), cpu=40, ram=50, disk=60,
                                tcp_established=10)
    MetricSample.objects.create(server=server, ts=now - timedelta(minutes=2), cpu=60, ram=50, disk=60,
                                tcp_established=20)
    MetricSample.objects.create(server=server, ts=now - timedelta(days=3), cpu=5, ram=5, disk=5)
    Server.objects.filter(pk=server.pk).update(last_seen=now)
    c = client_for(Role.VIEWER)
    d = c.get("/api/monitoring/overview?range=24h").json()
    assert len(d["points"]) == 25
    last = d["points"][-1]
    assert last["cpu"] == 50 and last["conn"] == 15 and last["conn_max"] == 20
    assert d["points"][0]["cpu"] is None  # سه روز قبل خارج از بازه ۲۴ ساعت است
    assert d["servers"][0]["status"] == "ok"
    d7 = c.get("/api/monitoring/overview?range=7d").json()
    assert len(d7["points"]) == 29
    assert sum(1 for p in d7["points"] if p["cpu"] is not None) == 2


@pytest.mark.django_db
def test_bucket_boundaries_align_to_local_midnight():
    rng = stats.RANGES["30d"]
    t = stats.floor_to_step(timezone.now(), rng.step)
    local = timezone.localtime(t)
    assert (local.hour, local.minute) == (0, 0)


@pytest.mark.django_db
def test_alert_ack_permissions(server):
    ingest(disk=99)
    alert_id = Alert.objects.get(kind="disk_high").pk
    viewer = client_for(Role.VIEWER)
    assert viewer.post(f"/api/monitoring/alerts/{alert_id}/ack").status_code == 403
    admin = client_for(Role.ADMIN)
    assert admin.post(f"/api/monitoring/alerts/{alert_id}/ack").status_code == 204
    ids = [a["id"] for a in admin.get("/api/monitoring/alerts").json()]
    assert alert_id not in ids
    assert admin.post("/api/monitoring/alerts/ack-all").json()["acked"] >= 1
    assert admin.get("/api/monitoring/alerts").json() == []


# ---------- releases ----------

def form(**over):
    data = {
        "version": "2.5.0",
        "date": "۱۴۰۵/۰۷/۰۹",
        "channel": "stable",
        "platforms": ["Windows", "Linux"],
        "notes": "مورد اول\n\n  مورد دوم  ",
        "mandatory": "true",
        "rollout": "50",
    }
    data.update(over)
    return data


@pytest.mark.django_db
def test_publish_release_writes_manifest(releases_root):
    c = client_for(Role.ADMIN)
    exe = SimpleUploadedFile("asandesk-2.5.0.exe", b"MZ-binary", content_type="application/octet-stream")
    r = c.post("/api/releases", {**form(), "files": [exe]}, format="multipart")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["notes"] == ["مورد اول", "مورد دوم"]
    assert body["published_on"] == "2026-10-01"
    assert body["date"] == "1405/07/09"
    assert body["assets"][0]["platform"] == "Windows" and body["assets"][0]["size"] == 9

    manifest = json.loads((releases_root / "latest.json").read_text())
    assert manifest["version"] == "2.5.0" and manifest["mandatory"] is True and manifest["rollout"] == 50
    # آدرس عمومی از درخواست انتشار گرفته می‌شود
    assert manifest["assets"]["windows"]["url"] == "http://testserver/api/releases/2.5.0/download/windows"

    dl = APIClient().get("/api/releases/2.5.0/download/windows")
    assert dl.status_code == 200
    assert b"".join(dl.streaming_content) == b"MZ-binary"
    assert Release.objects.get(version="2.5.0").downloads == 1
    assert c.get("/api/releases/stats").json()["downloads_30d"] == 1


@pytest.mark.django_db
def test_beta_manifest_and_latest_selection(releases_root):
    c = client_for(Role.OWNER)
    assert c.post("/api/releases", form(version="2.4.1"), format="multipart").status_code == 201
    assert c.post("/api/releases", form(version="2.5.0-beta.2", channel="beta"), format="multipart").status_code == 201
    assert json.loads((releases_root / "latest.json").read_text())["version"] == "2.4.1"
    assert json.loads((releases_root / "latest-beta.json").read_text())["version"] == "2.5.0-beta.2"
    stats_ = c.get("/api/releases/stats").json()
    assert stats_["latest_stable"] == "2.4.1" and stats_["latest_beta"] == "2.5.0-beta.2"


@pytest.mark.parametrize("over,msg", [
    ({"version": "v2"}, "شماره نسخه معتبر نیست"),
    ({"platforms": []}, "حداقل یک پلتفرم"),
    ({"notes": "  \n "}, "توضیحات تغییرات"),
    ({"date": "فردا"}, "تاریخ انتشار معتبر نیست"),
])
@pytest.mark.django_db
def test_publish_validation(over, msg):
    c = client_for(Role.ADMIN)
    r = c.post("/api/releases", form(**over), format="multipart")
    assert r.status_code == 400
    assert msg in json.dumps(r.json(), ensure_ascii=False)


@pytest.mark.django_db
def test_duplicate_version_and_file_platform_checks():
    c = client_for(Role.ADMIN)
    assert c.post("/api/releases", form(), format="multipart").status_code == 201
    dup = c.post("/api/releases", form(), format="multipart")
    assert "قبلاً منتشر شده" in json.dumps(dup.json(), ensure_ascii=False)
    apk = SimpleUploadedFile("a.apk", b"x")
    r = c.post("/api/releases", {**form(version="2.6.0"), "files": [apk]}, format="multipart")
    assert r.status_code == 400 and "Android" in json.dumps(r.json(), ensure_ascii=False)
    txt = SimpleUploadedFile("a.txt", b"x")
    r = c.post("/api/releases", {**form(version="2.6.0"), "files": [txt]}, format="multipart")
    assert r.status_code == 400


@pytest.mark.django_db
def test_viewer_cannot_publish():
    viewer = client_for(Role.VIEWER)
    assert viewer.post("/api/releases", form(), format="multipart").status_code == 403
    assert viewer.get("/api/releases").status_code == 200


def test_version_ordering():
    versions = ["2.4.1", "2.5.0-beta.2", "2.5.0", "2.5.0-beta.10", "2.10.0", "2.5.0-alpha.1"]
    assert sorted(versions, key=version_key) == [
        "2.4.1", "2.5.0-alpha.1", "2.5.0-beta.2", "2.5.0-beta.10", "2.5.0", "2.10.0"
    ]
