from django.apps import AppConfig


class ActivityConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "activity"
    verbose_name = "لاگ فعالیت"

    def ready(self):
        from . import signals  # noqa: F401  (ورود و خروج)
