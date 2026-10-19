from django.core.management.base import BaseCommand

from accounts.setup import ensure_setup_code
from releases.services import write_manifests


class Command(BaseCommand):
    help = "چاپ کد راه‌اندازی اولیه و ساخت فایل‌های انتشار (idempotent)."

    def handle(self, *args, **options):
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
