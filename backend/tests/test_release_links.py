"""انتشار نسخه از روی لینک دانلود و تولید update.json اپلیکیشن."""

import hashlib
import json
from urllib.error import HTTPError

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import Role
from releases.models import Release

# فیکسچر autouse که ریشهٔ فایل‌ها را به پوشهٔ موقت می‌برد
from .test_api import client_for, form, releases_root  # noqa: F401

WIN_URL = "https://update.asandesk.ir/releases/1.4.9.4/AsanDesk-1.4.9.4-x86_64-install.exe"
DEB_URL = "https://update.asandesk.ir/releases/1.4.9.4/asandesk-1.4.9.4.deb"


class FakeResp:
    """پاسخ ساختگی urllib: فقط آنچه fetch_installer لازم دارد."""

    def __init__(self, url, body=b"binary-data", headers=None):
        self._url, self._body, self.headers = url, body, headers or {}

    def geturl(self):
        return self._url

    def read(self, n=-1):
        out, self._body = self._body[:n], self._body[n:]
        return out

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def links(monkeypatch, settings):
    settings.RELEASE_LINK_ALLOW_PRIVATE = True  # در آزمون DNS نداریم
    bodies = {WIN_URL: b"MZ-windows-installer", DEB_URL: b"!<arch>-deb"}
    asked = []

    def fake_open(url):
        asked.append(url)
        if url not in bodies:
            raise HTTPError(url, 404, "not found", {}, None)
        return FakeResp(url, bodies[url])

    monkeypatch.setattr("releases.links.open_url", fake_open)
    return asked


def link_form(**over):
    base = form(
        version="1.4.9.4", platforms=["Windows", "Linux"], mandatory="false", rollout="100",
        build="1494", message="سرویس تا ساعت ۲۳ در دسترس است", maintenance="false", enabled="true",
        links=json.dumps({"Windows": WIN_URL, "Linux": DEB_URL}),
    )
    base.update(over)
    return base


def as_text(response):
    return json.dumps(response.json(), ensure_ascii=False)


@pytest.mark.django_db
def test_publish_from_links_stores_files_and_generates_update_json(links, releases_root):  # noqa: F811
    c = client_for(Role.ADMIN)
    r = c.post("/api/releases", link_form(notes="رفع صفحهٔ طوسی\nاعلان به‌روزرسانی"), format="multipart")
    assert r.status_code == 201, r.content
    body = r.json()
    assert links == [WIN_URL, DEB_URL]
    assert body["build"] == 1494 and body["update_warnings"] == []
    by_platform = {a["platform"]: a for a in body["assets"]}
    assert by_platform["Windows"]["source_url"] == WIN_URL
    assert by_platform["Windows"]["filename"] == "AsanDesk-1.4.9.4-x86_64-install.exe"
    assert by_platform["Windows"]["sha256"] == hashlib.sha256(b"MZ-windows-installer").hexdigest()
    assert by_platform["Linux"]["size"] == len(b"!<arch>-deb")
    # فایل‌ها روی دیسک خود داشبورد هم هستند
    stored = releases_root / "files/1.4.9.4/AsanDesk-1.4.9.4-x86_64-install.exe"
    assert stored.read_bytes() == b"MZ-windows-installer"

    dl = c.get("/api/releases/1.4.9.4/update.json")
    assert dl.status_code == 200 and dl["Content-Disposition"] == 'attachment; filename="update.json"'
    data = json.loads(dl.content)
    assert data == {
        "app": "AsanDesk",
        "version": "1.4.9.4",
        "build": 1494,
        "force_update": False,
        "download_url": WIN_URL,
        "downloads": {"windows": WIN_URL, "linux": DEB_URL},
        "release_notes": "رفع صفحهٔ طوسی\nاعلان به‌روزرسانی",
        "message": "سرویس تا ساعت ۲۳ در دسترس است",
        "maintenance": False,
        "enabled": True,
        "support": {"bale_url": "https://ble.ir/join/AqZGNkLToJ", "bale_id": ""},
    }
    # ترتیب کلیدها مثل نمونهٔ README اپلیکیشن
    assert list(data)[:5] == ["app", "version", "build", "force_update", "download_url"]
    # latest.json داشبورد هم همچنان ساخته می‌شود
    assert json.loads((releases_root / "latest.json").read_text(encoding="utf-8"))["version"] == "1.4.9.4"


@pytest.mark.django_db
def test_linux_only_release_has_no_download_url(links):
    c = client_for(Role.ADMIN)
    r = c.post("/api/releases", link_form(platforms=["Linux"], links=json.dumps({"Linux": DEB_URL})), format="multipart")
    assert r.status_code == 201, r.content
    data = json.loads(c.get("/api/releases/1.4.9.4/update.json").content)
    assert "download_url" not in data and data["downloads"] == {"linux": DEB_URL}


@pytest.mark.django_db
@pytest.mark.parametrize("bad", [
    "http://update.asandesk.ir/releases/x/AsanDesk-1.exe",       # بدون https
    "https://evil.com/AsanDesk-1.exe",                             # دامنهٔ دیگر
    "https://asandesk.ir.evil.com/AsanDesk-1.exe",                 # شبیه دامنه
    "https://user:pw@update.asandesk.ir/AsanDesk-1.exe",           # نام‌کاربری
    "https://update.asandesk.ir:8443/AsanDesk-1.exe",              # پورت
])
def test_untrusted_links_are_rejected_without_any_request(links, bad):
    c = client_for(Role.ADMIN)
    r = c.post("/api/releases", link_form(platforms=["Windows"], links=json.dumps({"Windows": bad})), format="multipart")
    assert r.status_code == 400 and "links" in r.json()
    assert links == [] and Release.objects.count() == 0


@pytest.mark.django_db
def test_link_failures_create_nothing(links):
    c = client_for(Role.ADMIN)
    missing = "https://update.asandesk.ir/releases/1.4.9.4/missing.exe"
    r = c.post("/api/releases", link_form(platforms=["Windows"], links=json.dumps({"Windows": missing})), format="multipart")
    assert r.status_code == 400 and "404" in as_text(r)
    # لینک ویندوز یک فایل deb بدهد
    r = c.post("/api/releases", link_form(platforms=["Windows"], links=json.dumps({"Windows": DEB_URL})), format="multipart")
    assert r.status_code == 400 and "Windows" in as_text(r)
    # فایل و لینک برای یک پلتفرم
    exe = SimpleUploadedFile("AsanDesk-1.4.9.4.exe", b"MZ")
    body = {**link_form(platforms=["Windows"], links=json.dumps({"Windows": WIN_URL})), "files": [exe]}
    assert c.post("/api/releases", body, format="multipart").status_code == 400
    # لینک خراب نباید نسخه‌ای نیمه‌کاره بسازد
    assert Release.objects.count() == 0


@pytest.mark.django_db
def test_download_size_limit(links, settings):
    settings.RELEASE_MAX_FILE_SIZE = 5
    c = client_for(Role.ADMIN)
    r = c.post("/api/releases", link_form(platforms=["Windows"], links=json.dumps({"Windows": WIN_URL})), format="multipart")
    assert r.status_code == 400 and Release.objects.count() == 0


@pytest.mark.django_db
def test_patch_update_fields_and_permissions(links):
    admin = client_for(Role.ADMIN)
    admin.post("/api/releases", link_form(), format="multipart")
    r = admin.patch("/api/releases/1.4.9.4", {"message": "  تعمیر شبانه ", "maintenance": True, "enabled": False,
                                              "mandatory": True, "build": 1500}, format="json")
    assert r.status_code == 200 and r.json()["message"] == "تعمیر شبانه"
    data = json.loads(admin.get("/api/releases/1.4.9.4/update.json").content)
    assert data["maintenance"] is True and data["enabled"] is False
    assert data["force_update"] is True and data["build"] == 1500
    assert admin.patch("/api/releases/1.4.9.4", {"build": -1}, format="json").status_code == 400
    assert admin.patch("/api/releases/9.9.9", {"build": 1}, format="json").status_code == 404
    viewer = client_for(Role.VIEWER)
    assert viewer.patch("/api/releases/1.4.9.4", {"message": "x"}, format="json").status_code == 403
    assert viewer.get("/api/releases/1.4.9.4/update.json").status_code == 200
    assert APIClient().get("/api/releases/1.4.9.4/update.json").status_code == 403


@pytest.mark.django_db
def test_update_warnings_for_untrusted_download_host():
    c = client_for(Role.ADMIN)
    exe = SimpleUploadedFile("AsanDesk-2.0.0.exe", b"MZ")
    r = c.post("/api/releases", {**form(version="2.0.0", platforms=["Windows"]), "files": [exe]}, format="multipart")
    assert r.status_code == 201, r.content
    # لینک فایل بارگذاری‌شده روی آدرس خود پنل است (testserver، http) و اپلیکیشن آن را نمی‌پذیرد
    assert any("windows" in w for w in r.json()["update_warnings"])


@pytest.mark.django_db
def test_support_channel_is_in_update_json_and_can_be_changed(links):
    c = client_for(Role.ADMIN)
    r = c.post(
        "/api/releases",
        link_form(bale_url="https://ble.ir/join/OTHER", bale_id=" @asan desk "),
        format="multipart",
    )
    assert r.status_code == 201, r.content
    assert r.json()["bale_url"] == "https://ble.ir/join/OTHER" and r.json()["bale_id"] == "@asandesk"
    assert json.loads(c.get("/api/releases/1.4.9.4/update.json").content)["support"] == {
        "bale_url": "https://ble.ir/join/OTHER",
        "bale_id": "@asandesk",
    }
    # editable after publishing
    p = c.patch("/api/releases/1.4.9.4", {"bale_url": "https://ble.ir/join/NEW3", "bale_id": ""}, format="json")
    assert p.status_code == 200 and p.json()["bale_url"] == "https://ble.ir/join/NEW3"


@pytest.mark.django_db
@pytest.mark.parametrize("bad", [
    "http://ble.ir/join/x",
    "https://evil.com/join/x",
    "https://ble.ir.evil.com/join/x",
    "https://ble.ir@evil.com/join/x",
])
def test_support_channel_outside_ble_ir_is_rejected(links, bad):
    c = client_for(Role.ADMIN)
    r = c.post("/api/releases", link_form(bale_url=bad), format="multipart")
    assert r.status_code == 400 and "bale_url" in r.json()
    assert Release.objects.count() == 0
