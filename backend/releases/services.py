import hashlib
import json
import os
import re
import tempfile
from datetime import date

import jdatetime
from django.conf import settings

from .models import Channel, Release, version_key

_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def parse_jalali(value: str) -> date:
    """«۱۴۰۵/۰۷/۰۹» یا «1405-7-9» را به تاریخ میلادی تبدیل می‌کند."""
    parts = re.split(r"[/\-.]", value.strip().translate(_DIGITS))
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise ValueError("bad date")
    y, m, d = (int(p) for p in parts)
    return jdatetime.date(y, m, d).togregorian()


def to_jalali(value: date) -> str:
    return jdatetime.date.fromgregorian(date=value).strftime("%Y/%m/%d")


def file_sha256(f) -> str:
    h = hashlib.sha256()
    for chunk in f.chunks():
        h.update(chunk)
    f.seek(0)
    return h.hexdigest()


def latest_release(channels) -> Release | None:
    releases = list(Release.objects.filter(channel__in=channels).prefetch_related("assets"))
    return max(releases, key=lambda r: version_key(r.version), default=None)


BASE_URL_FILE = ".public_base_url"


def remember_base_url(request) -> str:
    """آدرس عمومی پنل را از درخواست (یا PUBLIC_BASE_URL) می‌گیرد و برای بازنویسی‌های بعدی ذخیره می‌کند."""
    base = settings.PUBLIC_BASE_URL or request.build_absolute_uri("/").rstrip("/")
    path = settings.RELEASES_ROOT / BASE_URL_FILE
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(base)
    except OSError:
        pass
    return base


def public_base_url() -> str:
    if settings.PUBLIC_BASE_URL:
        return settings.PUBLIC_BASE_URL
    try:
        return (settings.RELEASES_ROOT / BASE_URL_FILE).read_text().strip()
    except OSError:
        return ""


def release_manifest(release: Release | None) -> dict:
    if release is None:
        return {}
    base = public_base_url()
    return {
        "version": release.version,
        "channel": release.channel,
        "date": release.published_on.isoformat(),
        "mandatory": release.mandatory,
        "rollout": release.rollout,
        "notes": release.notes_list,
        "assets": {
            a.platform.lower(): {
                "url": f"{base}/api/releases/{release.version}/download/{a.platform.lower()}",
                "size": a.size,
                "sha256": a.sha256,
            }
            for a in release.assets.all()
        },
    }


def _atomic_write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def write_manifests():
    """latest.json (کانال پایدار) و latest-beta.json (جدیدترین نسخه بتا یا پایدار) را بازنویسی می‌کند.

    کلاینت از ORG_UPDATE_URL = https://asandesk.ir/releases/latest.json استفاده خواهد کرد.
    """
    root = settings.RELEASES_ROOT
    _atomic_write_json(root / "latest.json", release_manifest(latest_release([Channel.STABLE])))
    _atomic_write_json(root / "latest-beta.json", release_manifest(latest_release([Channel.STABLE, Channel.BETA])))
