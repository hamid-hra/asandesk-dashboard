from django.apps import AppConfig


class ReleasesConfig(AppConfig):
    name = "releases"
    verbose_name = "نسخه‌ها"

    def ready(self):
        from . import signals  # noqa: F401
