from django.apps import AppConfig


class ClientsConfig(AppConfig):
    name = "clients"
    verbose_name = "کلاینت‌ها و بازخوردها"

    def ready(self):
        from . import signals  # noqa: F401
