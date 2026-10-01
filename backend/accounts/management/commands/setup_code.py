from django.core.management.base import BaseCommand

from accounts.setup import ensure_setup_code


class Command(BaseCommand):
    help = "نمایش کد راه‌اندازی اولیه (تا وقتی حساب مالک ساخته نشده)."

    def handle(self, *args, **options):
        code = ensure_setup_code()
        self.stdout.write(f"SETUP CODE: {code}" if code else "حساب مالک قبلاً ساخته شده است.")
