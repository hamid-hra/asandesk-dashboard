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

from . import setup
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
