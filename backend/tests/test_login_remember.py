import json

import pytest
from django.test import Client

from accounts.models import Role, User


@pytest.fixture
def user(db):
    return User.objects.create_user(username="rem", password="x-pass-12345", role=Role.ADMIN)


def login(c, **extra):
    body = {"username": "rem", "password": "x-pass-12345", **extra}
    return c.post("/api/auth/login", json.dumps(body), content_type="application/json")


def test_remember_me_keeps_the_session_30_days(user, settings):
    c = Client()
    assert login(c, remember=True).status_code == 200
    assert c.session.get_expiry_age() == pytest.approx(settings.SESSION_REMEMBER_AGE, abs=5)
    assert not c.session.get_expire_at_browser_close()


def test_without_remember_the_session_ends_with_the_browser(user):
    c = Client()
    assert login(c, remember=False).status_code == 200
    assert c.session.get_expire_at_browser_close()


def test_old_clients_without_the_field_are_remembered(user, settings):
    c = Client()
    assert login(c).status_code == 200
    assert c.session.get_expiry_age() == pytest.approx(settings.SESSION_REMEMBER_AGE, abs=5)


def test_wrong_password_is_rejected(user):
    c = Client()
    assert login(c, password="nope").status_code == 400
