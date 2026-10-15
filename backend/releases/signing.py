"""Signature of update.json (so a hacked CDN account cannot feed the apps a fake notice or download link).

The app reads https://update.asandesk.ir/update.json and, when it has a signing key built in, also
update.json.sig: a detached Ed25519 signature over the exact bytes of update.json. Without a valid
signature the app ignores the file. The private key is created here on first use and never leaves the
secrets volume; the public key is shown in the panel and goes into the app (src/asandesk.rs, UPDATE_SIGNING_KEYS).
"""

import base64
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.conf import settings


def key_path() -> Path:
    return Path(settings.SECRETS_DIR) / "update_signing_key"


def _load() -> Ed25519PrivateKey:
    path = key_path()
    try:
        seed = base64.b64decode(path.read_text().strip(), validate=True)
        return Ed25519PrivateKey.from_private_bytes(seed)
    except (OSError, ValueError):
        pass
    key = Ed25519PrivateKey.generate()
    seed = key.private_bytes(
        serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    # owner-only from the first byte
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(base64.b64encode(seed).decode() + "\n")
    return key


def public_key_b64() -> str:
    raw = _load().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode()


def seed_b64() -> str:
    """The private seed, for the owner's offline backup (management command only)."""
    return base64.b64encode(
        _load().private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    ).decode()


def sign_b64(data: bytes) -> str:
    return base64.b64encode(_load().sign(data)).decode()
