from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import Role

# پیشوند مسیر API → بخش پنل. دسترسی هر بخش: none | view | edit
PATH_SECTIONS = (
    ("/api/monitoring/", "server"),
    ("/api/releases", "release"),
    ("/api/clients", "clients"),
    ("/api/tickets", "tickets"),
    ("/api/settings/users", "users"),
    ("/api/settings/backups", "backup"),
    ("/api/settings/ha", "ha"),
    ("/api/settings/activity", "activity"),
    # اعلان به کاربران پنل: هر کس کاربران را مدیریت می‌کند
    ("/api/settings/notices", "users"),
)


def section_for(request, view) -> str | None:
    explicit = getattr(view, "section", None)
    if explicit:
        return explicit
    path = request.path
    for prefix, section in PATH_SECTIONS:
        if path.startswith(prefix):
            return section
    return None


class SectionPermission(BasePermission):
    """مشاهده نیاز به سطح «مشاهده» و تغییر نیاز به «ویرایش» در همان بخش دارد.

    بخش از روی مسیر درخواست (یا ویژگی `section` ویو) تعیین می‌شود. مسیرهای ناشناخته:
    همه واردشده‌ها بخوانند و فقط کسی که حداقل یک بخش را می‌تواند ویرایش کند تغییر دهد.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.is_active):
            return False
        if user.must_change_password:
            # فقط خود نشانی‌های /api/auth/ (ورود، خروج، me، تغییر رمز) کلاس دسترسی جدا دارند و این‌جا نمی‌رسند
            raise PermissionDenied("ابتدا رمز عبور تازهٔ خودتان را بگذارید.", code="password_change_required")
        safe = request.method in SAFE_METHODS
        section = section_for(request, view)
        if section is None:
            return safe or user.can_manage
        level = user.level(section)
        return level in ("view", "edit") if safe else level == "edit"


# نام قدیمی (REST_FRAMEWORK در settings.py به آن اشاره می‌کند)
ReadOnlyForViewer = SectionPermission


class IsOwner(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == Role.OWNER)
