import re

import pytest
from rest_framework.test import APIClient

from accounts.models import Role, User
from config.version import CHANGELOG, VERSION


def test_version_is_the_newest_changelog_entry():
    assert VERSION == CHANGELOG[0]["version"]


def test_changelog_is_well_formed_and_newest_first():
    keys = []
    for e in CHANGELOG:
        assert re.fullmatch(r"\d+\.\d+\.\d+", e["version"])
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", e["date"])
        assert e["title"] and e["items"]
        assert all(t in ("new", "change", "fix") and text for t, text in e["items"])
        keys.append(tuple(int(p) for p in e["version"].split(".")))
    assert keys == sorted(keys, reverse=True)
    assert len(set(keys)) == len(keys)


@pytest.mark.django_db
def test_version_endpoint_needs_login_and_lists_changelog():
    assert APIClient().get("/api/version").status_code in (401, 403)

    user = User.objects.create_user(username="v", password="x-pass-12345", role=Role.VIEWER)
    c = APIClient()
    c.force_authenticate(user)
    res = c.get("/api/version")
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == VERSION
    assert body["changelog"][0]["items"][0].keys() == {"type", "text"}
    assert len(body["changelog"]) == len(CHANGELOG)
