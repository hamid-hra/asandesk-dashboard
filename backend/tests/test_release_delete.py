import json
from datetime import date

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import Role, User
from releases.models import DownloadEvent, Release, ReleaseAsset


@pytest.fixture(autouse=True)
def roots(tmp_path, settings):
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


def make_release(version, day):
    r = Release.objects.create(version=version, channel="stable", published_on=day, platforms=["Windows"], notes="x")
    a = ReleaseAsset.objects.create(
        release=r,
        platform="Windows",
        file=SimpleUploadedFile(f"AsanDesk-{version}-x86_64-install.exe", b"MZ-installer"),
        size=12,
        sha256="0" * 64,
    )
    DownloadEvent.objects.create(release=r, platform="Windows")
    return r, a


@pytest.mark.django_db
def test_deleting_a_release_removes_files_counters_and_updates_latest_json(roots):
    make_release("2.4.0", date(2026, 10, 1))
    wrong, asset = make_release("2.5.0", date(2026, 10, 7))
    path = roots / asset.file.name
    assert path.exists()

    c = client_for(Role.ADMIN)
    res = c.delete("/api/releases/2.5.0")
    assert res.status_code == 204

    assert not Release.objects.filter(version="2.5.0").exists()
    assert not ReleaseAsset.objects.filter(release__version="2.5.0").exists()
    assert not DownloadEvent.objects.filter(release__version="2.5.0").exists()
    assert not path.exists() and not path.parent.exists()
    # the other release is untouched
    assert Release.objects.get(version="2.4.0").assets.count() == 1
    # clients now see the previous release as the latest one
    assert json.loads((roots / "latest.json").read_text(encoding="utf-8"))["version"] == "2.4.0"
    assert c.get("/api/releases/2.5.0").status_code == 404


@pytest.mark.django_db
def test_deleting_the_only_release_leaves_an_empty_manifest(roots):
    make_release("2.5.0", date(2026, 10, 7))
    assert client_for(Role.OWNER).delete("/api/releases/2.5.0").status_code == 204
    assert json.loads((roots / "latest.json").read_text(encoding="utf-8")) == {}


@pytest.mark.django_db
def test_viewer_cannot_delete_and_nothing_changes(roots):
    _, asset = make_release("2.5.0", date(2026, 10, 7))
    res = client_for(Role.VIEWER).delete("/api/releases/2.5.0")
    assert res.status_code == 403
    assert Release.objects.filter(version="2.5.0").exists() and (roots / asset.file.name).exists()


@pytest.mark.django_db
def test_deleting_an_unknown_version_is_404():
    assert client_for(Role.ADMIN).delete("/api/releases/9.9.9").status_code == 404
