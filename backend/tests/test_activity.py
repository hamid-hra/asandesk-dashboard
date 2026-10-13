from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.core.cache import cache
from django.http import HttpResponse
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from activity import routes, service
from activity.middleware import ActivityMiddleware
from activity.models import ActivityLog


@pytest.fixture(autouse=True)
def fresh_throttle():
    cache.clear()  # الگوی ۱۰ ورود در دقیقه بین تست‌ها شمرده نشود


def as_user(role, perms=None, username=None):
    u = User.objects.create_user(username=username or f"u-{role}", password="x-Pass-12345", role=role, perms=perms or {})
    c = APIClient()
    c.force_authenticate(u)
    return c, u


def rows(**filters):
    return list(ActivityLog.objects.filter(**filters).order_by("pk"))


# ---------------- ورود و خروج ----------------

@pytest.mark.django_db
def test_login_logout_and_failed_login_are_logged():
    User.objects.create_user(username="sara", password="x-Pass-12345", role=Role.ADMIN, first_name="سارا")
    c = APIClient()
    r = c.post("/api/auth/login", {"username": "sara", "password": "wrong-password"}, format="json")
    assert r.status_code == 400
    bad = rows(action="auth.login_failed")[0]
    assert bad.ok is False and bad.username == "sara" and "wrong-password" not in bad.text

    assert c.post("/api/auth/login", {"username": "sara", "password": "x-Pass-12345"}, format="json").status_code == 200
    ok = rows(action="auth.login")[0]
    assert ok.username == "sara" and ok.display_name == "سارا" and ok.ok is True

    assert c.post("/api/auth/logout").status_code == 204
    assert rows(action="auth.logout")[0].username == "sara"
    # هر کدام دقیقاً یک ردیف: خود درخواست‌های login/logout خط عمومی جدا نمی‌نویسند
    assert [a.action for a in ActivityLog.objects.order_by("pk")] == ["auth.login_failed", "auth.login", "auth.logout"]


@pytest.mark.django_db
def test_failed_login_for_unknown_name_is_kept_without_a_user():
    APIClient().post("/api/auth/login", {"username": "ghost", "password": "x"}, format="json")
    row = rows(action="auth.login_failed")[0]
    assert row.user is None and row.username == "ghost"


# ---------------- ثبت کارها ----------------

@pytest.mark.django_db
def test_changes_are_logged_with_who_and_what_but_never_the_password():
    c, owner = as_user(Role.OWNER, username="boss")
    r = c.post("/api/settings/users", {"display_name": "سارا", "username": "sara", "password": "Str0ng-pass-99", "role": "admin"}, format="json")
    uid = r.json()["id"]
    c.patch(f"/api/settings/users/{uid}", {"password": "An0ther-pass-77"}, format="json")
    c.patch(f"/api/settings/users/{uid}", {"role": "viewer", "active": False}, format="json")
    c.delete(f"/api/settings/users/{uid}")

    got = rows(username="boss")
    assert [a.action for a in got] == ["users.create", "users.update", "users.update", "users.delete"]
    assert "sara" in got[0].text and "مدیر" in got[0].text
    assert "رمز" in got[1].text and "نقش" in got[2].text and "غیرفعال" in got[2].text
    assert all("pass" not in a.text.lower() for a in got)
    assert got[0].ip == "127.0.0.1"


@pytest.mark.django_db
def test_a_denied_change_is_logged_as_failed():
    c, _ = as_user(Role.VIEWER, username="v")
    assert c.post("/api/settings/backups/run", {}, format="json").status_code == 403
    row = rows(username="v")[0]
    assert row.ok is False and row.action == "backup.run" and row.text.startswith("دسترسی نداشت")


@pytest.mark.django_db
def test_reads_and_rejected_requests_are_not_logged():
    c, _ = as_user(Role.OWNER, username="boss")
    c.get("/api/settings/users")
    c.post("/api/settings/users", {"username": "x"}, format="json")  # 400: nothing changed
    assert ActivityLog.objects.filter(username="boss").count() == 0


@pytest.mark.django_db
def test_an_unlisted_change_still_gets_a_generic_line():
    class NewThingView:
        __module__ = "billing.views"

    rf = RequestFactory()
    request = rf.post("/api/billing/charge")
    request.user = User.objects.create_user(username="o", password="x-Pass-12345", role=Role.OWNER)
    mw = ActivityMiddleware(lambda r: HttpResponse(status=201))
    mw.process_view(request, SimpleNamespace(cls=NewThingView), (), {})
    mw(request)
    row = rows(username="o")[0]
    assert row.action == routes.FALLBACK_ACTION and "POST /api/billing/charge" in row.text


def test_label_that_cannot_be_filled_falls_back():
    assert routes.render("نسخهٔ {d[version]}", {}, {}, "generic") == "generic"
    assert routes.render(lambda kw, d: kw["missing"], {}, {}, "generic") == "generic"
    assert routes.render(None, {}, {}, "generic") == "generic"


@pytest.mark.django_db
def test_logging_failure_never_breaks_the_request(monkeypatch):
    c, _ = as_user(Role.OWNER, username="boss")

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(ActivityLog.objects, "create", boom)
    r = c.post("/api/settings/users", {"display_name": "n", "username": "newbie", "password": "Str0ng-pass-99", "role": "viewer"}, format="json")
    assert r.status_code == 201


# ---------------- دسترسی ----------------

@pytest.mark.django_db
def test_only_the_owner_sees_the_log_by_default():
    owner, _ = as_user(Role.OWNER, username="o")
    assert owner.get("/api/settings/activity").status_code == 200
    admin, _ = as_user(Role.ADMIN, username="a")
    viewer, _ = as_user(Role.VIEWER, username="v")
    assert admin.get("/api/settings/activity").status_code == 403
    assert viewer.get("/api/settings/activity").status_code == 403


@pytest.mark.django_db
def test_owner_can_give_one_manager_access_to_the_log():
    owner, _ = as_user(Role.OWNER, username="o")
    r = owner.post("/api/settings/users", {"display_name": "مدیر", "username": "mgr", "password": "Str0ng-pass-99", "role": "admin", "perms": {"activity": "view", "users": "edit", "junk": "edit"}}, format="json")
    assert r.status_code == 201
    uid = r.json()["id"]
    assert r.json()["perms"]["activity"] == "view"
    assert r.json()["perms"]["users"] == "none"  # فقط «لاگ فعالیت» جدا داده می‌شود، نه بخش‌های دیگر
    assert User.objects.get(pk=uid).perms == {"activity": "view"}
    User.objects.filter(pk=uid).update(must_change_password=False)  # a new user changes the temporary password first (test_first_login)

    mgr = APIClient()
    mgr.force_authenticate(User.objects.get(pk=uid))
    assert mgr.get("/api/settings/activity").status_code == 200
    assert mgr.get("/api/auth/me").json()["perms"]["activity"] == "view"

    other, _ = as_user(Role.ADMIN, username="other-mgr")
    assert other.get("/api/settings/activity").status_code == 403  # مدیر دیگر هنوز ندارد

    # گرفتن دسترسی
    assert owner.patch(f"/api/settings/users/{uid}", {"perms": {}}, format="json").status_code == 200
    mgr2 = APIClient()
    mgr2.force_authenticate(User.objects.get(pk=uid))
    assert mgr2.get("/api/settings/activity").status_code == 403


@pytest.mark.django_db
def test_changing_the_role_drops_the_extra_access():
    owner, _ = as_user(Role.OWNER, username="o")
    u = User.objects.create_user(username="m", password="x-Pass-12345", role=Role.ADMIN, perms={"activity": "view"})
    r = owner.patch(f"/api/settings/users/{u.pk}", {"role": "viewer"}, format="json")
    assert r.status_code == 200 and r.json()["perms"]["activity"] == "none"
    r = owner.patch(f"/api/settings/users/{u.pk}", {"role": "custom", "perms": {"activity": "edit", "clients": "view"}}, format="json")
    assert r.json()["perms"]["activity"] == "view" and r.json()["perms"]["clients"] == "view"  # «ویرایش» همان «مشاهده»


@pytest.mark.django_db
def test_a_user_cannot_hand_out_log_access_they_do_not_have():
    c, _ = as_user(Role.CUSTOM, {"users": "edit"}, username="hr")
    body = {"display_name": "n", "password": "Str0ng-pass-99", "role": "custom"}
    r = c.post("/api/settings/users", {**body, "username": "x1", "perms": {"activity": "view"}}, format="json")
    assert r.status_code == 403
    r = c.post("/api/settings/users", {**body, "username": "x2", "perms": {"users": "view"}}, format="json")
    assert r.status_code == 201


@pytest.mark.django_db
def test_system_access_is_never_grantable():
    u = User(role=Role.CUSTOM, perms={"system": "edit", "activity": "edit"}, is_active=True)
    assert u.resolved_perms()["system"] == "none"
    assert User(role=Role.ADMIN, perms={"system": "edit"}, is_active=True).resolved_perms()["system"] == "none"
    assert User(role=Role.OWNER, is_active=True).resolved_perms()["system"] == "edit"


# ---------------- فهرست و فیلتر ----------------

def seed():
    now = timezone.now()
    ActivityLog.objects.bulk_create([
        ActivityLog(username="sara", display_name="سارا", action="release.create", category="release", text="نسخهٔ 1.0 را منتشر کرد", created_at=now - timedelta(days=3, hours=1)),
        ActivityLog(username="sara", display_name="سارا", action="tickets.reply", category="tickets", text="به بازخورد T-1 پاسخ داد", created_at=now - timedelta(days=2)),
        ActivityLog(username="ali", display_name="علی", action="backup.run", category="backup", text="پشتیبان‌گیری دستی را شروع کرد", created_at=now - timedelta(days=1)),
        ActivityLog(username="ali", display_name="علی", action="auth.login_failed", category="auth", text="ورود ناموفق", ok=False, created_at=now),
    ])


@pytest.mark.django_db
def test_list_filters_by_person_category_text_and_result():
    seed()
    c, _ = as_user(Role.OWNER, username="o")
    body = c.get("/api/settings/activity").json()
    assert [r["text"] for r in body["rows"]][0] == "ورود ناموفق"  # تازه‌ترین اول
    assert {p["username"]: p["count"] for p in body["people"]} == {"sara": 2, "ali": 2}

    assert {r["username"] for r in c.get("/api/settings/activity?user=sara").json()["rows"]} == {"sara"}
    assert [r["action"] for r in c.get("/api/settings/activity?category=backup").json()["rows"]] == ["backup.run"]
    assert len(c.get("/api/settings/activity?q=پاسخ").json()["rows"]) == 1
    assert [r["ok"] for r in c.get("/api/settings/activity?ok=0").json()["rows"]] == [False]
    day = (timezone.localtime() - timedelta(days=2)).strftime("%Y-%m-%d")
    assert len(c.get(f"/api/settings/activity?since={day}&until={day}").json()["rows"]) == 1
    assert c.get("/api/settings/activity?since=garbage").status_code == 200


@pytest.mark.django_db
def test_list_pages_with_a_cursor():
    seed()
    c, _ = as_user(Role.OWNER, username="o")
    first = c.get("/api/settings/activity?limit=3").json()
    assert len(first["rows"]) == 3 and first["next"] is not None and "people" in first
    second = c.get(f"/api/settings/activity?limit=3&before={first['next']}").json()
    assert len(second["rows"]) == 1 and second["next"] is None and "people" not in second
    assert {r["id"] for r in first["rows"]}.isdisjoint(r["id"] for r in second["rows"])


@pytest.mark.django_db
def test_history_survives_deleting_the_account():
    owner, _ = as_user(Role.OWNER, username="o")
    u = User.objects.create_user(username="gone", password="x-Pass-12345", role=Role.ADMIN, first_name="رفته")
    service.record("release.create", "نسخهٔ 2 را منتشر کرد", user=u)
    owner.delete(f"/api/settings/users/{u.pk}")
    body = owner.get("/api/settings/activity?user=gone").json()
    assert body["rows"][0]["display_name"] == "رفته"
    assert any(p["username"] == "gone" and p["exists"] is False for p in owner.get("/api/settings/activity").json()["people"])


@pytest.mark.django_db
def test_the_log_cannot_be_changed_through_the_api():
    seed()
    c, _ = as_user(Role.OWNER, username="o")
    assert c.delete("/api/settings/activity").status_code == 405
    assert c.post("/api/settings/activity", {}, format="json").status_code == 405


# ---------------- پاکسازی ----------------

@pytest.mark.django_db
def test_purge_removes_only_old_rows(settings):
    seed()
    assert service.purge(3) == 1  # فقط ردیف سه روز پیش؛ ردیف دو روز پیش می‌ماند
    assert ActivityLog.objects.count() == 3
    settings.ACTIVITY_KEEP_DAYS = 0
    assert service.purge() == 0  # ۰ = هرگز
    assert ActivityLog.objects.count() == 3
