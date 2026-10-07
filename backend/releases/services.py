import hashlib
import json
import logging
import os
import re
import tempfile
from datetime import date
from urllib.parse import quote

import jdatetime
from django.conf import settings
from django.db import transaction

from .models import Channel, Release, version_key

log = logging.getLogger(__name__)

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
    # آدرس دانلود باید به نام کامل فایل نصب ختم شود تا کلاینت بتواند آن را ذخیره و
    # اجرا کند (آپدیت خودکار). نام فایل آخرِ مسیر است؛ نصب‌کننده هم با آن نام ذخیره می‌شود.
    assets = {}
    for a in release.assets.all():
        platform = a.platform.lower()
        fname = quote(os.path.basename(a.file.name))
        assets[platform] = {
            "url": f"{base}/api/releases/{release.version}/download/{platform}/{fname}",
            "size": a.size,
            "sha256": a.sha256,
        }
    return {
        "version": release.version,
        "channel": release.channel,
        "date": release.published_on.isoformat(),
        "mandatory": release.mandatory,
        "rollout": release.rollout,
        "notes": release.notes_list,
        "assets": assets,
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

    کلاینت از ORG_UPDATE_URL = https://api.asandesk.ir/releases/latest.json استفاده می‌کند.
    """
    root = settings.RELEASES_ROOT
    _atomic_write_json(root / "latest.json", release_manifest(latest_release([Channel.STABLE])))
    _atomic_write_json(root / "latest-beta.json", release_manifest(latest_release([Channel.STABLE, Channel.BETA])))


def delete_release(release: Release) -> None:
    """حذف کامل یک نسخه: رکورد، فایل‌های نصب روی دیسک، و شمارندهٔ دانلودهای آن.

    بعد از حذف latest.json و latest-beta.json دوباره ساخته می‌شوند، پس اگر نسخهٔ حذف‌شده «آخرین»
    بود کلاینت‌ها نسخهٔ قبلی را می‌بینند. فایل‌هایی که مالک روی CDN گذاشته (لینک‌هایی که داده بود)
    دست‌نخورده می‌مانند؛ فقط نسخه‌ای که داشبورد خودش نگه می‌داشت پاک می‌شود.
    """
    paths = []
    for a in release.assets.all():
        if a.file:
            try:
                paths.append(a.file.storage.path(a.file.name))
            except NotImplementedError:
                pass
    with transaction.atomic():
        release.delete()
    folders = set()
    for p in paths:
        folders.add(os.path.dirname(p))
        try:
            os.remove(p)
        except FileNotFoundError:
            pass
        except OSError as e:
            log.warning("could not remove release file %s: %s", p, e)
    for d in folders:
        try:
            os.rmdir(d)  # only when it is empty
        except OSError:
            pass
    write_manifests()


# ---------------------------------------------------------------------------
# فایل update.json اپلیکیشن (src/asandesk.rs ← parse_update_manifest)
# ---------------------------------------------------------------------------

# اپلیکیشن فقط این سیستم‌عامل‌ها را در downloads.<os> می‌خواند
UPDATE_OS_KEYS = {"Windows": "windows", "macOS": "macos", "Linux": "linux"}
CLIENT_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(\.\d+)?$")


def asset_download_url(release: Release, asset) -> str:
    """لینکی که در update.json می‌آید: همان لینکی که مالک داده، وگرنه لینک دانلود خود داشبورد."""
    if asset.source_url:
        return asset.source_url
    base = public_base_url()
    fname = quote(os.path.basename(asset.file.name))
    return f"{base}/api/releases/{release.version}/download/{asset.platform.lower()}/{fname}"


def update_manifest(release: Release) -> dict:
    """update.json همین نسخه، با همان قالبی که README اپلیکیشن شرح می‌دهد."""
    downloads = {}
    for a in release.assets.all():
        key = UPDATE_OS_KEYS.get(a.platform)
        if key:
            downloads[key] = asset_download_url(release, a)
    data = {
        "app": "AsanDesk",
        "version": release.version,
        "build": release.build,
        "force_update": release.mandatory,
    }
    # نسخه‌های 1.4.9.1 و 1.4.9.2 فقط download_url را می‌شناسند و آن همیشه exe ویندوز است
    if "windows" in downloads:
        data["download_url"] = downloads["windows"]
    data.update(
        {
            "downloads": downloads,
            "release_notes": "\n".join(release.notes_list),
            "message": release.message,
            "maintenance": release.maintenance,
            "enabled": release.enabled,
            "support": {"bale_url": release.bale_url, "bale_id": release.bale_id},
        }
    )
    return data


def update_warnings(release: Release) -> list[str]:
    """چیزهایی که باعث می‌شود اپلیکیشن پیشنهاد دانلود را نشان ندهد."""
    from .links import is_trusted_support_url, is_trusted_url

    out = []
    if not CLIENT_VERSION_RE.match(release.version):
        out.append("اپلیکیشن فقط نسخه‌های سه یا چهاربخشی عددی (مثل 1.4.9.4) را می‌شناسد.")
    downloads = update_manifest(release)["downloads"]
    if not downloads:
        out.append("برای ویندوز یا لینوکس لینک دانلود ندارد؛ اپلیکیشن فقط پیام را نشان می‌دهد.")
    for key, url in downloads.items():
        if not is_trusted_url(url):
            out.append(f"لینک {key} روی دامنهٔ آسان‌دسک با https نیست؛ اپلیکیشن آن را نمی‌پذیرد.")
    if release.bale_url and not is_trusted_support_url(release.bale_url):
        out.append("لینک کانال بله باید https و روی ble.ir باشد؛ وگرنه اپلیکیشن لینک پیش‌فرض خودش را نشان می‌دهد.")
    return out


def update_json_bytes(release: Release) -> bytes:
    return (json.dumps(update_manifest(release), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
