"""Abuse limits and anti-evasion rules for the public endpoints (the app API and the panel login)."""

import json

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from clients.models import Client, Ticket

from .test_clients import app_post, feedback, panel, register


@pytest.fixture(autouse=True)
def isolate(tmp_path, settings):
    settings.RELEASES_ROOT = tmp_path
    settings.MEDIA_ROOT = tmp_path
    cache.clear()  # the counters live in the cache


def login_attempt(i, **headers):
    return APIClient().post("/api/auth/login", {"username": "nobody", "password": f"wrong-{i}"}, format="json", **headers)


# ---------- panel login: the limit follows the address nginx resolved, not a header the client writes

@pytest.mark.django_db
def test_login_limit_cannot_be_dodged_with_a_forged_x_forwarded_for():
    codes = [
        login_attempt(i, HTTP_X_REAL_IP="5.5.5.5", HTTP_X_FORWARDED_FOR=f"10.0.{i}.1").status_code for i in range(14)
    ]
    assert codes[:10] == [400] * 10 and 429 in codes[10:]


@pytest.mark.django_db
def test_login_limit_is_per_address():
    codes = [login_attempt(i, HTTP_X_REAL_IP=f"6.6.6.{i}").status_code for i in range(14)]
    assert set(codes) == {400}  # every address has its own allowance


# ---------- unauthenticated device creation

def heartbeat(rd_id, uuid=None, ip="7.7.7.7"):
    body = {"id": rd_id, "uuid": uuid or f"uuid-{rd_id}"}
    return APIClient().generic("POST", "/api/heartbeat", json.dumps(body), content_type="application/json", HTTP_X_REAL_IP=ip)


@pytest.mark.django_db
def test_new_devices_per_address_are_capped(settings):
    settings.CLIENT_NEW_DEVICES_PER_IP_HOUR = 3
    codes = [heartbeat(f"7000{i}").status_code for i in range(5)]
    assert codes == [200, 200, 200, 401, 401]
    assert Client.objects.count() == 3
    # known devices keep working, and another address has its own allowance
    assert heartbeat("70000").status_code == 200
    assert heartbeat("70009", ip="8.8.8.8").status_code == 200


# ---------- a blocked machine stays blocked under a new ID

@pytest.mark.django_db
def test_a_blocked_machine_stays_blocked_under_a_new_id():
    admin = panel()
    assert heartbeat("111111111", "MACHINE").json()["blocked"] is False
    assert admin.post("/api/clients/111111111/block", {"blocked": True}, format="json").json()["blocked"]

    # reinstalling gives a new ID but the machine uuid is the same
    assert heartbeat("222222222", "MACHINE", ip="9.9.9.9").json()["blocked"] is True
    assert Client.objects.get(rd_id="222222222").blocked
    assert heartbeat("333333333", "OTHER-MACHINE", ip="9.9.9.9").json()["blocked"] is False

    # unblocking lifts every ID of that machine
    out = admin.post("/api/clients/111111111/block", {"blocked": False}, format="json").json()
    assert out == {"blocked": False, "machines": 2}
    assert not Client.objects.filter(blocked=True).exists()


@pytest.mark.django_db
def test_blocking_one_device_does_not_touch_another_machine():
    admin = panel()
    heartbeat("444444444", "A")
    heartbeat("555555555", "B", ip="9.9.9.9")
    admin.post("/api/clients/444444444/block", {"blocked": True}, format="json")
    assert Client.objects.get(rd_id="444444444").blocked and not Client.objects.get(rd_id="555555555").blocked


# ---------- feedback: per-address cap and a storage ceiling

@pytest.mark.django_db
def test_feedback_per_address_cap(settings):
    settings.CLIENT_FEEDBACK_PER_IP_HOUR = 2
    register()
    codes = [feedback(log=None).status_code for _ in range(3)]
    assert codes == [201, 201, 429]


@pytest.mark.django_db
def test_feedback_keeps_only_the_text_when_the_storage_is_full(settings):
    register()
    settings.FEEDBACK_MAX_TOTAL_BYTES = 10
    assert feedback().status_code == 201  # the first one still gets its log
    r = feedback()
    assert r.status_code == 201 and r.json()["attachments_dropped"] is True
    newest = Ticket.objects.order_by("-pk").first()
    assert newest.messages.count() == 1 and not newest.log_file and newest.log_size == 0
    # a feedback without attachments is not reported as "dropped"
    assert "attachments_dropped" not in feedback(log=None).json()
