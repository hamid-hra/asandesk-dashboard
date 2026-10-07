"""دانلود فایل نصب از لینکی که مالک می‌دهد (به‌جای بارگذاری دستی از مرورگر).

لینک‌ها همان قاعدهٔ اپلیکیشن را دارند: فقط https روی دامنهٔ آسان‌دسک یا زیردامنه‌هایش، بدون
نام‌کاربری و بدون پورت غیرپیش‌فرض. این قاعده جلوی سوءاستفاده از داشبورد برای فرستادن درخواست به
سرورهای دیگر یا شبکهٔ داخلی (SSRF) را هم می‌گیرد؛ نشانی هر تغییرمسیر هم دوباره بررسی می‌شود.
"""

import hashlib
import ipaddress
import os
import re
import socket
import tempfile
import time
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from django.conf import settings
from django.core.files import File

from .models import PLATFORM_EXTENSIONS

CHUNK = 1024 * 1024
USER_AGENT = "AsanDesk-Dashboard/1.0"


class LinkError(Exception):
    """پیام فارسی برای نمایش به مالک."""


def trusted_domain() -> str:
    return settings.RELEASE_LINK_DOMAIN.lower()


def is_trusted_url(raw: str) -> bool:
    """همان قاعدهٔ is_trusted_url در src/asandesk.rs (اپلیکیشن لینک‌های دیگر را رد می‌کند)."""
    try:
        parts = urlsplit((raw or "").strip())
        port = parts.port
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    domain = trusted_domain()
    return (
        parts.scheme == "https"
        and not parts.username
        and not parts.password
        and port in (None, 443)
        and (host == domain or host.endswith("." + domain))
    )


def _check_not_internal(host: str):
    """نام میزبان نباید به آدرس خصوصی یا محلی برسد."""
    if settings.RELEASE_LINK_ALLOW_PRIVATE:
        return
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise LinkError(f"آدرس {host} پیدا نشد.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise LinkError("این لینک به آدرس داخلی اشاره می‌کند و دانلود نمی‌شود.")


def check_url(raw: str) -> str:
    url = (raw or "").strip()
    if not is_trusted_url(url):
        raise LinkError(
            f"لینک باید با https شروع شود و روی {trusted_domain()} یا زیردامنه‌هایش باشد "
            "(بدون نام‌کاربری و پورت)؛ اپلیکیشن لینک‌های دیگر را نمی‌پذیرد."
        )
    _check_not_internal(urlsplit(url).hostname or "")
    return url


class _CheckedRedirect(HTTPRedirectHandler):
    max_redirections = 5

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            check_url(newurl)
        except LinkError as e:
            raise HTTPError(newurl, code, str(e), headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_url(url: str):
    """باز کردن لینک؛ نقطهٔ جایگزینی در آزمون‌ها."""
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    return build_opener(_CheckedRedirect()).open(req, timeout=settings.RELEASE_LINK_CONNECT_TIMEOUT)


def platform_of_name(name: str):
    lower = name.lower()
    for ext, platform in PLATFORM_EXTENSIONS.items():
        if lower.endswith(ext):
            return platform
    return None


def _file_name(resp, final_url: str) -> str:
    disp = resp.headers.get("Content-Disposition") or ""
    m = re.search(r"filename\*=(?:UTF-8'')?([^;]+)", disp, re.IGNORECASE) or re.search(r'filename="?([^";]+)"?', disp, re.IGNORECASE)
    raw = unquote(m.group(1).strip()) if m else unquote(os.path.basename(urlsplit(final_url).path))
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", os.path.basename(raw)).strip(" .")
    return name[:120]


class DownloadedFile(File):
    """فایل موقتِ دانلودشده با اندازه و SHA-256 آماده."""

    def __init__(self, tmp, name: str, size: int, sha256: str):
        super().__init__(tmp, name=name)
        self.size = size
        self.sha256 = sha256


def fetch_installer(raw_url: str) -> DownloadedFile:
    """فایل را دانلود می‌کند. هر مشکلی LinkError با پیام فارسی است."""
    url = check_url(raw_url)
    limit = settings.RELEASE_MAX_FILE_SIZE
    deadline = time.monotonic() + settings.RELEASE_LINK_TOTAL_TIMEOUT
    try:
        resp = open_url(url)
    except HTTPError as e:
        raise LinkError(f"سرور لینک خطا داد (HTTP {e.code}).")
    except (URLError, OSError, ValueError) as e:
        raise LinkError(f"به لینک وصل نشد: {getattr(e, 'reason', e)}")
    tmp = tempfile.NamedTemporaryFile(prefix="link-", dir=settings.FILE_UPLOAD_TEMP_DIR or None)
    try:
        with resp:
            length = resp.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > limit:
                raise LinkError("حجم فایل بیشتر از حد مجاز است.")
            name = _file_name(resp, resp.geturl())
            if not name or platform_of_name(name) is None:
                raise LinkError("نام فایل لینک باید با exe، msi، dmg، pkg، deb، rpm، AppImage یا apk تمام شود.")
            h, size = hashlib.sha256(), 0
            while True:
                chunk = resp.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise LinkError("حجم فایل بیشتر از حد مجاز است.")
                if time.monotonic() > deadline:
                    raise LinkError("دانلود بیش از حد طول کشید.")
                h.update(chunk)
                tmp.write(chunk)
        if size == 0:
            raise LinkError("فایل لینک خالی است.")
        tmp.flush()
        tmp.seek(0)
        return DownloadedFile(tmp, name, size, h.hexdigest())
    except LinkError:
        tmp.close()
        raise
    except (OSError, ValueError, HTTPException) as e:
        tmp.close()
        raise LinkError(f"دانلود قطع شد: {e}")
