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
