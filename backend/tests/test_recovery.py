import json

import pytest
from django.core.cache import cache
from django.test import Client

from accounts import recovery
from accounts.models import RecoveryCode, Role, User

PASSWORD = "old-pass-12345"
NEW_PASSWORD = "brand-new-pass-678"


@pytest.fixture(autouse=True)
def _fresh_throttle():
    cache.clear()  # the throttle counters live in the cache and would leak between tests
    yield
    cache.clear()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="sara", password=PASSWORD, role=Role.ADMIN)


def post(c, path, body):
    return c.post(path, json.dumps(body), content_type="application/json")


def signed_in(user):
    c = Client()
    assert c.login(username=user.username, password=PASSWORD)
    return c


def reset(c, **over):
    body = {"username": "sara", "code": "", "password": NEW_PASSWORD, **over}
    return post(c, "/api/auth/recovery/reset", body)


def test_code_format_and_normalizing():
    code = recovery.new_code()
    assert len(code) == 14 and code.count("-") == 2
    assert recovery.normalize(code.lower().replace("-", " ")) == recovery.normalize(code)
    assert recovery.digest(1, code) != recovery.digest(2, code)


def test_generate_needs_login_and_the_current_password(user):
    assert post(Client(), "/api/auth/recovery/generate", {"password": PASSWORD}).status_code in (401, 403)
    c = signed_in(user)
    assert post(c, "/api/auth/recovery/generate", {"password": "wrong"}).status_code == 400
    assert recovery.remaining(user) == 0


def test_generate_returns_codes_once_and_stores_only_hashes(user):
    c = signed_in(user)
    res = post(c, "/api/auth/recovery/generate", {"password": PASSWORD})
    assert res.status_code == 200
    codes = res.json()["codes"]
    assert len(codes) == recovery.COUNT == len(set(codes))
    assert c.get("/api/auth/recovery").json() == {"remaining": recovery.COUNT, "total": recovery.COUNT}
    stored = set(RecoveryCode.objects.values_list("code_hash", flat=True))
    assert not any(code in h or recovery.normalize(code) in h for code in codes for h in stored)


def test_regenerating_invalidates_the_old_codes(user):
    c = signed_in(user)
    old = post(c, "/api/auth/recovery/generate", {"password": PASSWORD}).json()["codes"]
    post(c, "/api/auth/recovery/generate", {"password": PASSWORD})
    assert reset(Client(), code=old[0]).status_code == 400


def test_reset_sets_the_new_password_and_the_code_works_once(user):
    code = recovery.generate_for(user)[0]
    res = reset(Client(), code=code.lower())  # case does not matter
    assert res.status_code == 200 and res.json()["remaining"] == recovery.COUNT - 1
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)
    # the same code a second time
    assert reset(Client(), code=code, password="another-pass-9999").status_code == 400
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)


def test_reset_signs_out_the_old_sessions(user):
    c = signed_in(user)
    assert c.get("/api/auth/me").status_code == 200
    reset(Client(), code=recovery.generate_for(user)[0])
    assert c.get("/api/auth/me").status_code in (401, 403)


def test_a_weak_password_does_not_burn_the_code(user):
    code = recovery.generate_for(user)[0]
    res = reset(Client(), code=code, password="123")
    assert res.status_code == 400 and "password" in res.json()
    assert recovery.remaining(user) == recovery.COUNT
    assert reset(Client(), code=code).status_code == 200


def test_wrong_code_unknown_user_and_inactive_user_get_the_same_answer(user):
    recovery.generate_for(user)
    bad = reset(Client(), code="AAAA-BBBB-CCCC")
    unknown = reset(Client(), username="nobody", code="AAAA-BBBB-CCCC")
    assert bad.status_code == unknown.status_code == 400
    assert bad.json() == unknown.json()

    code = recovery.generate_for(user)[0]
    user.is_active = False
    user.save()
    off = reset(Client(), code=code)
    assert off.status_code == 400 and off.json() == bad.json()


def test_a_code_of_another_user_does_not_work(user):
    other = User.objects.create_user(username="ali", password=PASSWORD, role=Role.VIEWER)
    code = recovery.generate_for(other)[0]
    assert reset(Client(), code=code).status_code == 400


def test_reset_is_rate_limited(user):
    statuses = [reset(Client(), code="AAAA-BBBB-CCCC").status_code for _ in range(7)]
    assert statuses[:5] == [400] * 5 and 429 in statuses[5:]
