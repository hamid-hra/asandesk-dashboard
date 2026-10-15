"""update.json is signed with a key that stays on the server."""

import base64
import json

import pytest
from django.utils import timezone
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from rest_framework.test import APIClient

from accounts.models import Role, User
from releases import signing
from releases.models import Release


@pytest.fixture(autouse=True)
def isolate(tmp_path, settings):
    settings.RELEASES_ROOT = tmp_path
    settings.MEDIA_ROOT = tmp_path
    settings.SECRETS_DIR = tmp_path / "secrets"


def panel(role=Role.ADMIN):
    user, _ = User.objects.get_or_create(username=f"p-{role}", defaults={"role": role})
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def release(db):
    return Release.objects.create(version="1.5.0", published_on=timezone.localdate(), notes="x", platforms=["Windows"])


@pytest.mark.django_db
def test_signature_matches_the_exact_bytes_of_update_json(release):
    c = panel()
    body = c.get("/api/releases/1.5.0/update.json").content
    sig = base64.b64decode(c.get("/api/releases/1.5.0/update.json.sig").content.strip(), validate=True)
    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(c.get("/api/releases/update-key").json()["public_key"]))
    key.verify(sig, body)  # raises when wrong
    assert json.loads(body)["version"] == "1.5.0"
    with pytest.raises(InvalidSignature):
        key.verify(sig, body.replace(b"1.5.0", b"9.9.9"))  # a changed file does not verify


@pytest.mark.django_db
def test_the_key_is_created_once_kept_private_and_reused(release, settings):
    first = signing.public_key_b64()
    assert signing.public_key_b64() == first
    path = signing.key_path()
    assert path.exists() and len(base64.b64decode(path.read_text().strip())) == 32
    # the private seed is not exposed through the API
    c = panel()
    seed = path.read_text().strip()
    for url in ("/api/releases/update-key", "/api/releases/1.5.0/update.json.sig", "/api/releases/1.5.0/update.json"):
        assert seed not in c.get(url).content.decode()


@pytest.mark.django_db
def test_anonymous_cannot_read_the_signature(release):
    assert APIClient().get("/api/releases/1.5.0/update.json.sig").status_code == 403
