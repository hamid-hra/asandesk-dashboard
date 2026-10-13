import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts import recovery
from accounts.models import Role, User
from activity.models import ActivityLog

TEMP = "Temp-pass-12345"
NEW = "Str0ng-new-pass-77"


@pytest.fixture(autouse=True)
def fresh_throttle():
    cache.clear()


def as_user(role=Role.ADMIN, perms=None, username=None, **extra):
    u = User.objects.create_user(username=username or f"u-{role}", password=TEMP, role=role, perms=perms or {}, **extra)
    c = APIClient()
    c.force_authenticate(u)
    return c, u


def create_user_via_api(owner, username="sabri", role="viewer"):
    r = owner.post("/api/settings/users", {"display_name": "sajad sabri", "username": username, "password": TEMP, "role": role}, format="json")
    assert r.status_code == 201, r.content
    return r.json()


# ---------------- who has to change the password ----------------

@pytest.mark.django_db
def test_a_user_made_by_the_owner_must_change_the_password():
    owner, _ = as_user(Role.OWNER, username="boss")
    row = create_user_via_api(owner)
    assert row["must_change_password"] is True
    assert User.objects.get(username="sabri").must_change_password is True
    assert User.objects.create_user(username="plain", password=TEMP).must_change_password is False  # setup / shell users are not flagged


@pytest.mark.django_db
def test_owner_resetting_someone_elses_password_flags_it_but_not_their_own():
    owner, boss = as_user(Role.OWNER, username="boss")
    other = User.objects.create_user(username="other", password=TEMP, role=Role.ADMIN)
    r = owner.patch(f"/api/settings/users/{other.pk}", {"password": "An0ther-temp-99"}, format="json")
    assert r.status_code == 200 and r.json()["must_change_password"] is True
    r = owner.patch(f"/api/settings/users/{boss.pk}", {"password": "My-own-new-pass-55"}, format="json")
    assert r.status_code == 200 and r.json()["must_change_password"] is False


@pytest.mark.django_db
def test_forgot_password_reset_clears_the_flag():
    u = User.objects.create_user(username="m", password=TEMP, role=Role.ADMIN, must_change_password=True)
    code = recovery.generate_for(u)[0]
    r = APIClient().post("/api/auth/recovery/reset", {"username": "m", "code": code, "password": NEW}, format="json")
    assert r.status_code == 200
    u.refresh_from_db()
    assert u.must_change_password is False  # they chose this password themselves


# ---------------- nothing works until it is changed ----------------

@pytest.mark.django_db
def test_a_flagged_user_can_only_reach_the_account_endpoints():
    c, _ = as_user(Role.ADMIN, username="new", must_change_password=True)
    me = c.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["must_change_password"] is True
    for path in ["/api/clients", "/api/tickets", "/api/releases", "/api/monitoring/overview", "/api/version", "/api/settings/backups/"]:
        r = c.get(path)
        assert r.status_code == 403, path
        assert r.json().get("detail", "").startswith("ابتدا رمز")
    assert c.post("/api/releases", {}, format="json").status_code == 403
    assert c.post("/api/auth/logout").status_code == 204


@pytest.mark.django_db
def test_an_unflagged_user_is_not_affected():
    c, _ = as_user(Role.ADMIN, username="ok")
    assert c.get("/api/releases").status_code == 200  # (the clients API needs Postgres, so this probe is a lighter endpoint)


# ---------------- the change itself ----------------

@pytest.mark.django_db
def test_changing_the_password_unlocks_the_panel_and_keeps_this_session():
    owner, _ = as_user(Role.OWNER, username="boss")
    create_user_via_api(owner, username="sabri", role="viewer")

    c = APIClient()
    assert c.post("/api/auth/login", {"username": "sabri", "password": TEMP}, format="json").status_code == 200
    assert c.get("/api/releases").status_code == 403

    r = c.post("/api/auth/password", {"current_password": TEMP, "new_password": NEW}, format="json")
    assert r.status_code == 200 and "codes" not in r.json()
    assert c.get("/api/auth/me").json()["must_change_password"] is False
    assert c.get("/api/releases").status_code == 200  # the same browser session is still valid
    assert APIClient().post("/api/auth/login", {"username": "sabri", "password": TEMP}, format="json").status_code == 400
    assert APIClient().post("/api/auth/login", {"username": "sabri", "password": NEW}, format="json").status_code == 200
    assert ActivityLog.objects.filter(username="sabri", action="auth.password_change").exists()


@pytest.mark.django_db
def test_the_change_can_hand_out_recovery_codes_once():
    c, u = as_user(Role.VIEWER, username="v", must_change_password=True)
    assert recovery.remaining(u) == 0
    r = c.post("/api/auth/password", {"current_password": TEMP, "new_password": NEW, "generate_codes": True}, format="json")
    body = r.json()
    assert r.status_code == 200 and len(body["codes"]) == recovery.COUNT and body["total"] == recovery.COUNT
    assert recovery.remaining(u) == recovery.COUNT
    assert all(recovery.is_valid(u, code) for code in body["codes"])


@pytest.mark.django_db
@pytest.mark.parametrize(
    "current,new,field",
    [
        ("wrong-current", NEW, "current_password"),
        (TEMP, TEMP, "new_password"),  # the same password is no change
        (TEMP, "short", "new_password"),
        (TEMP, "12345678", "new_password"),
        (TEMP, "password", "new_password"),
        (TEMP, "", "new_password"),
    ],
)
def test_a_bad_change_is_refused_and_keeps_the_flag(current, new, field):
    c, u = as_user(Role.VIEWER, username="v", must_change_password=True)
    r = c.post("/api/auth/password", {"current_password": current, "new_password": new}, format="json")
    assert r.status_code == 400 and field in r.json()
    u.refresh_from_db()
    assert u.must_change_password is True and u.check_password(TEMP)


@pytest.mark.django_db
def test_password_change_needs_a_signed_in_user_and_is_rate_limited():
    assert APIClient().post("/api/auth/password", {"current_password": "x", "new_password": "y"}, format="json").status_code == 403
    c, _ = as_user(Role.VIEWER, username="v")
    codes = [c.post("/api/auth/password", {"current_password": "wrong", "new_password": NEW}, format="json").status_code for _ in range(12)]
    assert codes[0] == 400 and codes[-1] == 429  # 10 tries a minute


# ---------------- what goes into the login file ----------------

@pytest.mark.django_db
def test_access_info_is_only_for_people_who_can_create_users(settings):
    settings.PANEL_KEY = "Kjo1prZX7aST10g6UA"
    owner, _ = as_user(Role.OWNER, username="boss")
    assert owner.get("/api/settings/users/access").json() == {"entry_key": "Kjo1prZX7aST10g6UA"}
    hr, _ = as_user(Role.CUSTOM, {"users": "edit"}, username="hr")
    assert hr.get("/api/settings/users/access").status_code == 200
    reader, _ = as_user(Role.CUSTOM, {"users": "view"}, username="reader")
    assert reader.get("/api/settings/users/access").status_code == 403  # may list users, not hand out the key
    admin, _ = as_user(Role.ADMIN, username="adm")
    assert admin.get("/api/settings/users/access").status_code == 403


@pytest.mark.django_db
def test_access_info_is_empty_when_the_gate_is_off(settings):
    settings.PANEL_KEY = ""
    owner, _ = as_user(Role.OWNER, username="boss")
    assert owner.get("/api/settings/users/access").json() == {"entry_key": ""}
