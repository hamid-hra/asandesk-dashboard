import json

import pytest
from rest_framework.test import APIClient

from accounts.models import Role, User
from clients.models import Client, ConnFailure

DEV = {"id": "482913557", "uuid": "dXVpZC0x"}


@pytest.fixture(autouse=True)
def isolate(tmp_path, settings):
    settings.RELEASES_ROOT = tmp_path
    settings.MEDIA_ROOT = tmp_path


def report(**over):
    body = {**DEV, "peer": "123456789", "reason": "server_unreachable", "type": "desktop", "version": "1.5.0.1",
            "detail": "deadline has elapsed", **over}
    return APIClient().generic("POST", "/api/client/conn-failure", json.dumps(body), content_type="text/plain")


def panel():
    user, _ = User.objects.get_or_create(username="p-admin", defaults={"role": Role.ADMIN})
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.mark.django_db
def test_failure_report_is_stored_and_unknown_reason_becomes_other():
    assert report().status_code == 201
    assert report(reason="wrong_password", peer="555").status_code == 201
    assert report(reason="<script>").status_code == 201
    rows = {f.reason: f for f in ConnFailure.objects.all()}
    assert set(rows) == {"server_unreachable", "wrong_password", "other"}
    assert rows["server_unreachable"].detail == "deadline has elapsed" and rows["wrong_password"].peer_id == "555"
    # a wrong uuid for a known device is refused, a blocked device is not recorded
    assert report(uuid="other").status_code == 401
    Client.objects.filter(rd_id=DEV["id"]).update(blocked=True)
    assert report().status_code == 403
    assert ConnFailure.objects.count() == 3


@pytest.mark.django_db
def test_charts_group_failures_by_side():
    for reason in ("server_unreachable", "server_no_answer", "id_not_exist", "offline", "offline"):
        report(reason=reason)
    f = panel().get("/api/clients/charts").json()["failures"]
    assert f["total"] == 5 and f["last_24h"] == 5 and f["devices"] == 1
    assert f["groups"] == {"server": 2, "user": 1, "peer": 2}
    assert f["reasons"][0] == {"reason": "offline", "group": "peer", "count": 2, "devices": 1, "peers": 1}
    assert f["daily"][-1]["total"] == 5 and f["daily"][-1]["groups"]["server"] == 2
    assert len(f["daily"]) == f["days"] == 30
    assert f["recent"][0]["device"] == DEV["id"] and f["recent"][0]["peer"] == "123456789"


@pytest.mark.django_db
def test_failure_reports_are_capped_per_device(settings):
    settings.CLIENT_CONN_FAILURES_PER_HOUR = 2
    assert [report().status_code for _ in range(3)] == [201, 201, 429]
