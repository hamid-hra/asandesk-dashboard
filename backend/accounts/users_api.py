"""مدیریت کاربران پنل: /api/settings/users (بخش «users»)."""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import LEVELS, SECTIONS, Role, User, clean_perms

ASSIGNABLE = (Role.ADMIN, Role.VIEWER, Role.CUSTOM)
RANK = {lv: i for i, lv in enumerate(LEVELS)}


def user_row(u: User, me: User) -> dict:
    return {
        "id": u.pk,
        "username": u.username,
        "display_name": u.display_name,
        "role": u.role,
        "role_label": u.get_role_display(),
        "active": u.is_active,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "created": u.date_joined.isoformat(),
        "perms": {k: u.level(k) for k in SECTIONS} if u.is_active else clean_perms(u.perms) if u.role == Role.CUSTOM else None,
        "me": u.pk == me.pk,
        "locked": u.role == Role.OWNER,
    }


def exceeds(actor: User, perms: dict) -> bool:
    """آیا این دسترسی‌ها از دسترسی خود کاربر عمل‌کننده بیشتر است؟ (مالک محدود نمی‌شود)"""
    if actor.role == Role.OWNER:
        return False
    mine = actor.resolved_perms()
    return any(RANK[perms.get(k, "none")] > RANK[mine.get(k, "none")] for k in SECTIONS)


def error(field: str, msg: str, code=status.HTTP_400_BAD_REQUEST):
    return Response({field: [msg]}, status=code)


def effective(role: str, perms) -> dict:
    """دسترسی نهایی نقش/دسترسی داده‌شده، بدون ساخت کاربر."""
    return User(role=role, perms=perms or {}, is_active=True).resolved_perms()


class UserListView(APIView):
    def get(self, request):
        users = User.objects.order_by("date_joined", "pk")
        return Response([user_row(u, request.user) for u in users])

    def post(self, request):
        d = request.data
        username = (d.get("username") or "").strip()
        name = (d.get("display_name") or "").strip()
        password = d.get("password") or ""
        role = d.get("role")
        if not name or len(name) > 150:
            return error("display_name", "نام نمایشی را وارد کنید.")
        if not username or len(username) > 150:
            return error("username", "نام کاربری را وارد کنید.")
        try:
            User.username_validator(username)
        except ValidationError:
            return error("username", "نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد و @/./+/-/_ باشد.")
        if User.objects.filter(username__iexact=username).exists():
            return error("username", "این نام کاربری قبلاً استفاده شده است.")
        if role not in ASSIGNABLE:
            return error("role", "نقش نامعتبر است.")
        perms = clean_perms(d.get("perms")) if role == Role.CUSTOM else {}
        if exceeds(request.user, effective(role, perms)):
            return Response({"detail": "نمی‌توانید دسترسی بیشتر از دسترسی خودتان بدهید."}, status=status.HTTP_403_FORBIDDEN)
        user = User(username=username, first_name=name, role=role, perms=perms, is_active=d.get("active", True) is not False)
        try:
            validate_password(password, user)
        except ValidationError as e:
            return Response({"password": list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(password)
        user.save()
        return Response(user_row(user, request.user), status=status.HTTP_201_CREATED)


class UserDetailView(APIView):
    def patch(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        actor = request.user
        d = request.data
        if user.role == Role.OWNER and actor.role != Role.OWNER:
            return Response({"detail": "فقط مالک می‌تواند حساب مالک را ویرایش کند."}, status=status.HTTP_403_FORBIDDEN)
        if user.role != Role.OWNER and exceeds(actor, user.resolved_perms() if user.is_active else clean_perms(user.perms)):
            return Response({"detail": "این کاربر از شما دسترسی بیشتری دارد."}, status=status.HTTP_403_FORBIDDEN)

        if "display_name" in d:
            name = (d.get("display_name") or "").strip()
            if not name or len(name) > 150:
                return error("display_name", "نام نمایشی را وارد کنید.")
            user.first_name, user.last_name = name, ""

        if user.role == Role.OWNER:
            # حساب مالک قفل است: نقش و فعال‌بودنش تغییر نمی‌کند
            if ("role" in d and d["role"] != Role.OWNER) or d.get("active") is False:
                return Response({"detail": "حساب مالک قفل است."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            role = d.get("role", user.role)
            if role not in ASSIGNABLE:
                return error("role", "نقش نامعتبر است.")
            perms = clean_perms(d["perms"]) if "perms" in d and role == Role.CUSTOM else (user.perms if role == Role.CUSTOM else {})
            if exceeds(actor, effective(role, perms)):
                return Response({"detail": "نمی‌توانید دسترسی بیشتر از دسترسی خودتان بدهید."}, status=status.HTTP_403_FORBIDDEN)
            if user.pk == actor.pk and (role != user.role or d.get("active") is False):
                return Response({"detail": "نقش یا وضعیت حساب خودتان را نمی‌توانید تغییر دهید."}, status=status.HTTP_400_BAD_REQUEST)
            user.role, user.perms = role, perms
            if "active" in d:
                user.is_active = bool(d["active"])

        if d.get("password"):
            try:
                validate_password(d["password"], user)
            except ValidationError as e:
                return Response({"password": list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)
            user.set_password(d["password"])
        user.save()
        return Response(user_row(user, actor))

    def delete(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        if user.role == Role.OWNER:
            return Response({"detail": "حساب مالک قابل حذف نیست."}, status=status.HTTP_400_BAD_REQUEST)
        if user.pk == request.user.pk:
            return Response({"detail": "حساب خودتان را نمی‌توانید حذف کنید."}, status=status.HTTP_400_BAD_REQUEST)
        if exceeds(request.user, user.resolved_perms() if user.is_active else clean_perms(user.perms)):
            return Response({"detail": "این کاربر از شما دسترسی بیشتری دارد."}, status=status.HTTP_403_FORBIDDEN)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
