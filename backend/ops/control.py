"""Client for the `control` service (see /control): panel update, update job and docker logs.

`control` is the only part of the stack that can talk to Docker. It listens on the compose network
only, and answers just the backend, which proves who it is with a token from a shared volume.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings


class ControlError(Exception):
    def __init__(self, message: str, status: int = 502, offline: bool = False):
        super().__init__(message)
        self.message = message
        self.status = status
        self.offline = offline


def _token() -> str:
    token = os.environ.get("CONTROL_TOKEN", "").strip()
    if token:
        return token
    try:
        return settings.CONTROL_TOKEN_FILE.read_text().strip()
    except OSError:
        return ""


def call(method: str, path: str, *, params: dict | None = None, body: dict | None = None, timeout: float = 20) -> dict:
    """One request to `control`; returns its JSON body or raises ControlError with a message fit for the panel."""
    token = _token()
    if not token:
        raise ControlError("سرویس control فعال نیست (توکن آن پیدا نشد). راهنما در README: «به‌روزرسانی از داخل پنل».", offline=True)
    url = settings.CONTROL_URL.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"X-Control-Token": token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error") or ""
        except (ValueError, AttributeError):
            msg = ""
        raise ControlError(msg or f"سرویس control خطا داد ({e.code}).", status=409 if e.code == 409 else 502) from e
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        raise ControlError("به سرویس control وصل نشد. مطمئن شوید در docker compose بالا آمده است.", offline=True) from e
    except ValueError as e:
        raise ControlError("پاسخ سرویس control قابل خواندن نبود.") from e
