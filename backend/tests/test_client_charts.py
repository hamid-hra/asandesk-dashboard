from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from clients.models import Account, Client
from releases.models import Release

WIN = "windows / Windows 11 Pro - 22631"
LINUX = "linux / Ubuntu 22.04"


@pytest.fixture(autouse=True)
def isolate(tmp_path, settings):
    settings.RELEASES_ROOT = tmp_path
    settings.MEDIA_ROOT = tmp_path


def panel(role=Role.ADMIN, perms=None):
    user, _ = User.objects.get_or_create(username=f"c-{role}", defaults={"role": role, "perms": perms or {}})
    c = APIClient()
    c.force_authenticate(user)
    return c


def device(rd_id, os, version, first_days_ago=1, seen_days_ago=0, account=None):
    now = timezone.now()
    return Client.objects.create(
        rd_id=rd_id, os=os, version=version, account=account,
        first_seen=now - timedelta(days=first_days_ago), last_seen=now - timedelta(days=seen_days_ago),
    )


@pytest.mark.django_db
def test_charts_count_installs_by_platform_and_version():
    Release.objects.create(version="1.4.9.9", published_on=timezone.localdate(), notes="x", platforms=["Windows"])
    acc = Account.objects.create(email="a@b.c")
    device("1", WIN, "1.4.9.9", account=acc)
    device("2", WIN, "1.4.9.8")
    device("3", WIN, "1.4.9.8", seen_days_ago=45)  # an install that has not been seen for a while
    device("4", LINUX, "1.4.9.9", first_days_ago=60)
    device("5", LINUX, "")

    body = panel().get("/api/clients/charts").json()
    t = body["totals"]
    assert (t["installs"], t["active_30d"], t["new_30d"], t["logged"]) == (5, 4, 4, 1)  # device 4 was installed 60 days ago, so it is not new
    assert body["latest"] == "1.4.9.9"
    # latest = 2 of the 4 active devices
    assert t["on_latest"] == 2 and t["on_latest_share"] == 50.0

    plats = {p["platform"]: p for p in body["platforms"]}
    assert plats["Windows"]["installs"] == 3 and plats["Windows"]["active_30d"] == 2
    assert plats["Linux"]["installs"] == 2 and plats["Linux"]["new_30d"] == 1
    assert [p["platform"] for p in body["platforms"]] == ["Windows", "Linux"]  # most installs first
    assert plats["Windows"]["share"] == 60.0

    vers = {v["version"]: v for v in body["versions"]}
    assert vers["1.4.9.8"]["installs"] == 2 and vers["1.4.9.8"]["platforms"] == {"Windows": 2} and vers["1.4.9.8"]["old"] is True
    assert vers["1.4.9.9"]["platforms"] == {"Windows": 1, "Linux": 1} and vers["1.4.9.9"]["latest"] is True
    assert vers[""]["installs"] == 1  # a device that has not reported its version
    # the device seen 45 days ago counts as an install but not as active
    assert vers["1.4.9.8"]["active_30d"] == 1 and vers["1.4.9.8"]["platforms_active"] == {"Windows": 1}


@pytest.mark.django_db
def test_daily_series_has_one_entry_per_day_and_a_running_total():
    device("1", WIN, "1", first_days_ago=200)  # installed long before the window
    device("2", WIN, "1", first_days_ago=3)
    device("3", LINUX, "1", first_days_ago=3)
    device("4", WIN, "1", first_days_ago=0)

    daily = panel().get("/api/clients/charts").json()["daily"]
    assert len(daily) == 90 and daily[-1]["date"] == timezone.localdate().isoformat()
    assert daily[0]["total"] == 1  # the old install is counted from the first day
    assert daily[-1]["total"] == 4 and sum(d["new"] for d in daily) == 3
    three_days_ago = next(d for d in daily if d["new"] == 2)
    assert three_days_ago["platforms"] == {"Windows": 1, "Linux": 1}


@pytest.mark.django_db
def test_charts_without_any_client_or_release():
    body = panel().get("/api/clients/charts").json()
    assert body["totals"]["installs"] == 0 and body["totals"]["on_latest_share"] is None
    assert body["platforms"] == [] and body["versions"] == [] and len(body["daily"]) == 90


@pytest.mark.django_db
def test_charts_follow_the_clients_permission():
    assert panel(Role.VIEWER).get("/api/clients/charts").status_code == 200
    assert panel(Role.CUSTOM, {"clients": "none", "server": "edit"}).get("/api/clients/charts").status_code == 403
    assert APIClient().get("/api/clients/charts").status_code == 403
