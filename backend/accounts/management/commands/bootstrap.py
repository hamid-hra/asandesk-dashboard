import os
import secrets

from django.conf import settings
from django.core.management.base import BaseCommand

from accounts.setup import ensure_setup_code
from monitoring.models import Server, hash_token
from releases.services import write_manifests


def local_agent_token() -> str | None:
    """توکن agent محلی: از متغیر محیطی یا فایل مشترک (در صورت نبود ساخته می‌شود)."""
    token = os.environ.get("AGENT_TOKEN")
    if token:
        return token
    path = settings.AGENT_TOKEN_FILE
    try:
        token = path.read_text().strip()
        if token:
            return token
    except OSError:
        pass
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        token = secrets.token_urlsafe(32)
        path.write_text(token)
        os.chmod(path, 0o644)
        return token
    except OSError:
        return None


class Command(BaseCommand):
    help = "ثبت سرور محلی برای agent و چاپ کد راه‌اندازی اولیه (idempotent)."

    def handle(self, *args, **options):
        token = local_agent_token()
        if token:
            name = os.environ.get("LOCAL_SERVER_NAME", "dashboard-local")
            region = os.environ.get("LOCAL_SERVER_REGION", "محلی")
            if not Server.objects.filter(token_hash=hash_token(token)).exists():
                server = Server.objects.filter(name=name).first() or Server(name=name, region=region)
                server.set_token(token)
                server.save()
                self.stdout.write(self.style.SUCCESS(f"server '{name}' registered for local agent"))

        code = ensure_setup_code()
        if code:
            line = "=" * 64
            self.stdout.write(
                f"\n{line}\n"
                "  AsanDesk dashboard — first-run setup\n"
                "  هنوز حساب مالک ساخته نشده. پنل را در مرورگر باز کنید و این کد را وارد کنید:\n\n"
                f"      SETUP CODE:  {code}\n\n"
                "  این کد فقط یک بار و تا ساخت حساب مالک معتبر است.\n"
                f"{line}\n"
            )

        write_manifests()
