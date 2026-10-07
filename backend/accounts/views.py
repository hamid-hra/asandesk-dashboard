from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import connection, transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import recovery, setup
from .models import Role, User
from .serializers import UserSerializer


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"ok": True})


@method_decorator(csrf_protect, name="post")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""
        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response(
                {"detail": "نام کاربری یا رمز عبور اشتباه است."}, status=status.HTTP_400_BAD_REQUEST
            )
        login(request, user)
        # Missing field = remember (old clients); 0 = the session ends when the browser closes
        remember = request.data.get("remember", True) not in (False, 0, "0", "false", "False")
        request.session.set_expiry(settings.SESSION_REMEMBER_AGE if remember else 0)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class RecoveryStatusView(APIView):
    """How many unused recovery codes the signed-in user has left."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"remaining": recovery.remaining(request.user), "total": recovery.COUNT})


class RecoveryGenerateView(APIView):
    """New set of recovery codes (the old ones stop working). Needs the current password."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "recovery"

    def post(self, request):
        if not request.user.check_password(request.data.get("password") or ""):
            return Response({"password": ["رمز عبور فعلی درست نیست."]}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"codes": recovery.generate_for(request.user), "total": recovery.COUNT})


@method_decorator(csrf_protect, name="post")
class RecoveryResetView(APIView):
    """Forgot password: username + one recovery code + new password (signed out)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "recovery"

    # The same text for an unknown user, a wrong code and a used code: nothing to enumerate
    BAD = "نام کاربری یا کد بازیابی درست نیست."

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        code = request.data.get("code") or ""
        password = request.data.get("password") or ""

        user = User.objects.filter(username=username, is_active=True).first()
        if user is None:
            recovery.digest(0, code)  # similar work, so timing does not tell the user exists
            return Response({"detail": self.BAD}, status=status.HTTP_400_BAD_REQUEST)
        if not recovery.is_valid(user, code):
            return Response({"detail": self.BAD}, status=status.HTTP_400_BAD_REQUEST)
        # A weak password must not burn the code, so it is checked before the code is used
        try:
            validate_password(password, user)
        except ValidationError as e:
            return Response({"password": list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            if not recovery.consume(user, code):
                return Response({"detail": self.BAD}, status=status.HTTP_400_BAD_REQUEST)
            user.set_password(password)
            user.save(update_fields=["password"])
        # Django ties every session to the password hash, so old sessions of this user end here
        return Response({"ok": True, "remaining": recovery.remaining(user)})


@method_decorator(csrf_protect, name="post")
class SetupView(APIView):
    """ساخت حساب مالک در اولین ورود (فقط وقتی هیچ کاربری وجود ندارد)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "setup"

    def get_throttles(self):
        # GET فقط وضعیت را برمی‌گرداند و نباید محدود شود
        return super().get_throttles() if self.request.method == "POST" else []

    def get(self, request):
        return Response({"needed": setup.setup_needed()})

    def post(self, request):
        code = request.data.get("code") or ""
        username = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""

        if not setup.setup_needed():
            return Response({"detail": "حساب مالک قبلاً ساخته شده است."}, status=status.HTTP_409_CONFLICT)
        if not setup.check_setup_code(code):
            return Response({"code": ["کد راه‌اندازی نادرست است."]}, status=status.HTTP_400_BAD_REQUEST)
        if not username or len(username) > 150:
            return Response({"username": ["نام کاربری را وارد کنید."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            User.username_validator(username)
        except ValidationError:
            return Response(
                {"username": ["نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد و @/./+/-/_ باشد."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            validate_password(password, User(username=username))
        except ValidationError as e:
            return Response({"password": list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # جلوگیری از ساخت دو مالک با درخواست‌های همزمان
            with connection.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", [7031405])
            if not setup.setup_needed():
                return Response({"detail": "حساب مالک قبلاً ساخته شده است."}, status=status.HTTP_409_CONFLICT)
            user = User.objects.create_user(username=username, password=password, role=Role.OWNER)
        setup.clear_setup_code()
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)
