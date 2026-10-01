from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import Role


class ReadOnlyForViewer(BasePermission):
    """همه کاربران واردشده می‌توانند بخوانند؛ تغییر فقط برای مالک و مدیر."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return request.method in SAFE_METHODS or user.can_manage


class IsOwner(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == Role.OWNER)
