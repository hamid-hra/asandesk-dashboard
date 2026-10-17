import json
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from clients.models import Account, Client, ConnSession, Ticket
from monitoring import stats as mon

WIN = "windows / Windows 11 Pro - 22631"
LINUX = "linux / Ubuntu 22.04"


@pytest.fixture(autouse=True)
def isolate(tmp_path, settings):
    settings.RELEASES_ROOT = tmp_path
    settings.MEDIA_ROOT = tmp_path


def panel():
    user, _ = User.objects.get_or_create(username="p-admin", defaults={"role": Role.ADMIN})
    c = APIClient()
    c.force_authenticate(user)
    return c


def device(rd_id, hostname="", os=WIN, version="1.4.9.9", seen_ago=timedelta(0), account=None, blocked=False):
    now = timezone.now()
    return Client.objects.create(
        rd_id=rd_id, hostname=hostname, os=os, version=version, account=account, blocked=blocked,
        first_seen=now - timedelta(days=3), last_seen=now - seen_ago,
    )


def ids(path):
    return [r["id"] for r in panel().get(path).json()["results"]]


# ---------- هر ستون جدا فیلتر می‌شود ----------

@pytest.mark.django_db
def test_column_filters_combine_with_and():
    acc = Account.objects.create(email="a@b.c")
    device("1", "alpha", account=acc)                                  # آنلاین، وارد شده
    device("2", "bravo", seen_ago=timedelta(days=2))                   # آفلاین، مهمان
    device("3", "charlie", os=LINUX, seen_ago=timedelta(days=2), account=acc)  # آفلاین، وارد شده
    device("4", "delta", blocked=True)                                 # آنلاین، مهمان، مسدود

    assert set(ids("/api/clients?status=online")) == {"1", "4"}
    assert set(ids("/api/clients?status=offline")) == {"2", "3"}
    assert set(ids("/api/clients?account=logged")) == {"1", "3"}
    assert set(ids("/api/clients?account=guest")) == {"2", "4"}
    assert set(ids("/api/clients?blocked=1")) == {"4"}
    # ترکیب: آفلاین و وارد شده
    assert ids("/api/clients?status=offline&account=logged") == ["3"]
    assert ids("/api/clients?status=offline&account=logged&platform=Windows") == []
    # تب قدیمی «filter» هنوز کار می‌کند و با فیلتر ستون‌ها ترکیب می‌شود
    assert set(ids("/api/clients?filter=logged")) == {"1", "3"}
    assert ids("/api/clients?filter=logged&status=offline") == ["3"]


@pytest.mark.django_db
def test_tickets_filter_counts_only_new_feedback():
    c1, c2 = device("1"), device("2")
    Ticket.objects.create(client=c1, subject="x")
    Ticket.objects.create(client=c2, subject="y", status="closed")
    assert ids("/api/clients?tickets=1") == ["1"]


# ---------- ترتیب و جهت ----------

@pytest.mark.django_db
def test_sort_direction_and_defaults():
    device("1", "Bravo", version="1.4.10.1", seen_ago=timedelta(hours=5))
    device("2", "alpha", version="1.4.9.3", seen_ago=timedelta(hours=1))
    device("3", "charlie", version="", seen_ago=timedelta(hours=9))
    now = timezone.now()
    for cid, n in ((1, 3), (2, 1)):  # شمار نشست‌ها
        for _ in range(n):
            ConnSession.objects.create(client=Client.objects.get(rd_id=str(cid)), conn_id=n, authorized_at=now - timedelta(minutes=9),
                                       ended_at=now - timedelta(minutes=5))

    # نام: الفبایی (بدون توجه به بزرگی حروف)؛ جهت پیش‌فرض صعودی است
    assert ids("/api/clients?sort=name") == ["2", "1", "3"]
    assert ids("/api/clients?sort=name&dir=desc") == ["3", "1", "2"]
    # آخرین فعالیت (هر سه آفلاین‌اند): جدیدترین اول، یا قدیمی‌ترین اول
    assert ids("/api/clients?sort=recent") == ["2", "1", "3"]
    assert ids("/api/clients?sort=recent&dir=asc") == ["3", "1", "2"]
    # نسخه: «1.4.10.1» بعد از «1.4.9.3»؛ بدون نسخه آخر
    assert ids("/api/clients?sort=version") == ["1", "2", "3"]
    assert ids("/api/clients?sort=version&dir=asc") == ["3", "2", "1"]
    # نشست: بیشترین اول، یا کمترین اول
    assert ids("/api/clients?sort=sessions")[:2] == ["1", "2"]
    assert ids("/api/clients?sort=sessions&dir=asc")[-1] == "1"
    # جهت یا ترتیب نامعتبر = پیش‌فرض
    assert ids("/api/clients?sort=zzz&dir=up") == ids("/api/clients")


# ---------- درخواست‌های اتصال در «سرور و منابع» ----------

def session(client, started_ago, *, authorized=False, ended=True, result=""):
    now = timezone.now()
    return ConnSession.objects.create(
        client=client, conn_id=ConnSession.objects.count() + 1, started_at=now - started_ago,
        authorized_at=now - started_ago + timedelta(seconds=5) if authorized else None,
        ended_at=now - started_ago + timedelta(seconds=40) if ended else None, result=result,
    )


@pytest.mark.django_db
def test_request_counts_split_ok_pending_failed_cancelled_unknown():
    c = device("1")
    now = timezone.now()
    session(c, timedelta(minutes=30), authorized=True)
    session(c, timedelta(minutes=29), authorized=True, ended=False)       # هنوز وصل است: موفق
    session(c, timedelta(minutes=28), result="failed")
    session(c, timedelta(minutes=27), result="cancelled")
    session(c, timedelta(minutes=26))                                      # بدون علت: نامشخص
    session(c, timedelta(seconds=30), ended=False)                         # تازه شروع شده: در انتظار
    session(c, timedelta(minutes=20), ended=False)                         # بیش از ۲ دقیقه باز مانده: تمام‌شده
    session(c, timedelta(days=40), authorized=True)                        # خارج از بازه

    r = mon.request_counts(now - timedelta(days=1), now)
    assert (r["total"], r["ok"], r["pending"], r["failed"], r["cancelled"], r["unknown"]) == (7, 2, 1, 1, 1, 2)
    # نرخ ناموفق = (ناموفق + لغو + نامشخص) از درخواست‌های تمام‌شده، یعنی بدون «در انتظار»
    assert r["fail_rate"] == round(4 / 6 * 100, 2)
    assert mon.request_counts(now + timedelta(days=1), now)["fail_rate"] is None


@pytest.mark.django_db
def test_today_counts_start_at_local_midnight():
    c = device("1")
    now = timezone.now()
    start = mon.today_start(now)
    ConnSession.objects.create(client=c, conn_id=1, started_at=start + timedelta(seconds=1), authorized_at=start + timedelta(seconds=3))
    ConnSession.objects.create(client=c, conn_id=2, started_at=start - timedelta(seconds=1), authorized_at=start)
    assert mon.request_counts(start, now + timedelta(days=1))["total"] == 1


@pytest.mark.django_db
def test_overview_has_requests_failure_rate_and_series():
    c = device("1")
    session(c, timedelta(minutes=10), authorized=True)
    session(c, timedelta(minutes=9), result="cancelled")
    session(c, timedelta(minutes=8))

    body = panel().get("/api/monitoring/overview?range=24h").json()
    today, rng = body["requests"]["today"], body["requests"]["range"]
    assert rng["total"] == 3 and rng["ok"] == 1 and rng["cancelled"] == 1 and rng["unknown"] == 1
    assert body["sessions_total"] == 1 and body["fail_rate"] == round(2 / 3 * 100, 2)
    assert today["total"] <= rng["total"]
    # هر نقطهٔ نمودار شمار درخواست‌ها و ناموفق‌ها را دارد؛ جمع نقطه‌ها با بازه می‌خواند
    assert sum(p["req"] for p in body["points"]) == 3 and sum(p["fail"] for p in body["points"]) == 2
    assert all(isinstance(p["fail"], int) for p in body["points"])


# ---------- گزارش علت پایان از اپ ----------

def app_post(body):
    return APIClient().generic("POST", "/api/audit/conn", json.dumps(body), content_type="application/json")


@pytest.mark.django_db
def test_close_report_may_carry_a_result():
    dev = {"id": "482913557", "uuid": "dXVpZC0x"}
    APIClient().post("/api/heartbeat", dev, format="json")

    app_post({**dev, "conn_id": 1, "action": "new"})
    app_post({**dev, "conn_id": 1, "action": "close", "result": "cancelled"})
    app_post({**dev, "conn_id": 2, "action": "new"})
    app_post({**dev, "conn_id": 2, "action": "close", "result": "<script>"})  # ناشناخته نادیده گرفته می‌شود
    app_post({**dev, "conn_id": 3, "action": "new"})
    app_post({**dev, "conn_id": 3, "action": "close"})                          # اپ قدیمی: بدون علت

    got = {s.conn_id: s.result for s in ConnSession.objects.all()}
    assert got == {1: "cancelled", 2: "", 3: ""}


# ---------- صفحه‌بندی فهرست کلاینت‌ها ----------

@pytest.mark.django_db
def test_client_list_is_paged():
    for i in range(30):
        device(f"{100 + i}", f"pc-{i:02d}")
    c = panel()

    body = c.get("/api/clients?sort=name").json()
    assert (body["count"], body["page"], body["pages"], body["page_size"], len(body["results"])) == (30, 1, 2, 25, 25)
    assert body["results"][0]["display"] == "pc-00"
    assert len(c.get("/api/clients?sort=name&page=2").json()["results"]) == 5
    # اندازهٔ صفحه فقط از ۱۰، ۲۵، ۵۰ و ۱۰۰؛ چیز دیگری = ۲۵
    assert c.get("/api/clients?page_size=10").json()["pages"] == 3
    assert c.get("/api/clients?page_size=7").json()["page_size"] == 25
    assert len(c.get("/api/clients?page_size=100").json()["results"]) == 30
    # صفحهٔ بیرون از دامنه یا نامعتبر نمی‌شکند
    assert c.get("/api/clients?page=99").json()["page"] == 2
    assert c.get("/api/clients?page=abc&page_size=x").json()["page"] == 1
    # فیلتر شمار کل و صفحه‌ها را عوض می‌کند، نه فقط ردیف‌ها
    assert c.get("/api/clients?q=pc-0&page_size=10").json()["pages"] == 1


@pytest.mark.django_db
def test_facets_count_every_client_not_only_the_page():
    for i in range(30):
        device(f"{100 + i}", os=WIN if i < 20 else LINUX)
    facets = panel().get("/api/clients?page_size=10").json()["facets"]
    assert dict(facets["platforms"]) == {"Windows": 20, "Linux": 10}


# ---------- نسخه‌ها: نصب تازه و توزیع ----------

@pytest.mark.django_db
def test_release_stats_count_new_installs_not_panel_downloads():
    from releases.models import DownloadEvent, Release

    rel = Release.objects.create(version="1.5.0", published_on=timezone.localdate(), notes="x", platforms=["Windows"])
    # فایل روی CDN است: از پنل دانلود نشده، ولی دستگاه‌ها نصب کرده‌اند و به API گزارش داده‌اند
    now = timezone.now()
    Client.objects.create(rd_id="1", version="1.5.0", first_seen=now - timedelta(days=2), last_seen=now)
    Client.objects.create(rd_id="2", version="1.5.0", first_seen=now - timedelta(days=29), last_seen=now)
    Client.objects.create(rd_id="3", version="1.4.9.7", first_seen=now - timedelta(days=60), last_seen=now)
    assert DownloadEvent.objects.count() == 0

    body = panel().get("/api/releases/stats").json()
    assert body["downloads_30d"] == 0 and body["installs_30d"] == 2
    assert rel.version == body["latest_stable"]


@pytest.mark.django_db
def test_version_distribution_has_counts_and_groups_the_rest():
    from releases.models import Release

    Release.objects.create(version="1.5.0", published_on=timezone.localdate(), notes="x", platforms=["Windows"])
    now = timezone.now()
    n = 0
    for version, count in (("1.5.0", 10), ("1.4.9.7", 4), ("1.4.9.4", 3), ("1.4.9.1", 2), ("1.4.8", 1)):
        for _ in range(count):
            n += 1
            Client.objects.create(rd_id=str(n), version=version, last_seen=now)
    Client.objects.create(rd_id="9999", version="1.4.0", last_seen=now - timedelta(days=45))  # فعال نیست: نمی‌شمارد

    body = panel().get("/api/releases/stats").json()
    assert body["active_devices"] == 20 and body["users_on_current"] == 50.0
    dist = body["distribution"]
    assert [(d["version"], d["count"]) for d in dist] == [("1.5.0", 10), ("1.4.9.7", 4), ("1.4.9.4", 3), ("سایر نسخه‌ها", 3)]
    assert dist[-1]["versions"] == 2 and dist[0]["share"] == 50.0
    assert sum(d["count"] for d in dist) == body["active_devices"]


@pytest.mark.django_db
def test_release_list_shows_active_devices_per_version():
    from releases.models import Release

    for v in ("1.5.0", "1.4.9.7"):
        Release.objects.create(version=v, published_on=timezone.localdate(), notes="x", platforms=["Windows"])
    now = timezone.now()
    for i, v in enumerate(["1.5.0", "1.5.0", "1.4.9.7"]):
        Client.objects.create(rd_id=str(i + 1), version=v, last_seen=now)
    Client.objects.create(rd_id="50", version="1.4.9.7", last_seen=now - timedelta(days=40))  # دیگر فعال نیست

    got = {r["version"]: r["devices"] for r in panel().get("/api/releases").json()}
    assert got == {"1.5.0": 2, "1.4.9.7": 1}


@pytest.mark.django_db
def test_current_version_is_never_hidden_in_the_rest_group():
    from releases.models import Release

    Release.objects.create(version="1.5.0", published_on=timezone.localdate(), notes="x", platforms=["Windows"])
    now = timezone.now()
    n = 0
    # نسخهٔ فعلی کم‌تعدادترین است ولی باید جدا بیاید، نه توی «سایر»
    for version, count in (("1.4.9.7", 8), ("1.4.9.4", 6), ("1.4.9.1", 4), ("1.4.8", 3), ("1.5.0", 1)):
        for _ in range(count):
            n += 1
            Client.objects.create(rd_id=str(n), version=version, last_seen=now)

    dist = panel().get("/api/releases/stats").json()["distribution"]
    assert [(d["version"], d["count"]) for d in dist] == [("1.4.9.7", 8), ("1.4.9.4", 6), ("1.5.0", 1), ("سایر نسخه‌ها", 7)]
    assert dist[-1]["versions"] == 2


@pytest.mark.django_db
def test_up_to_four_versions_are_all_named():
    now = timezone.now()
    for i, version in enumerate(["1.4.9.7"] * 3 + ["1.4.9.4"] * 2 + ["1.4.9.1", "1.4.8"]):
        Client.objects.create(rd_id=str(i + 1), version=version, last_seen=now)

    dist = panel().get("/api/releases/stats").json()["distribution"]
    # بیشترین اول؛ دو نسخهٔ برابر به ترتیب نام
    assert [d["version"] for d in dist] == ["1.4.9.7", "1.4.9.4", "1.4.8", "1.4.9.1"]
    assert all("versions" not in d for d in dist) and sum(d["count"] for d in dist) == 7
