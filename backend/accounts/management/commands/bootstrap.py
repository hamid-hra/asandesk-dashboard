import os

from django.core.management.base import BaseCommand

from accounts.models import Role, User
from monitoring.models import Server, hash_token
from releases.services import write_manifests


class Command(BaseCommand):
    help = "ساخت مالک اولیه و سرور محلی از روی متغیرهای محیطی (idempotent)."

    def handle(self, *args, **options):
        username = os.environ.get("OWNER_USERNAME")
        password = os.environ.get("OWNER_PASSWORD")
        if username and password and not User.objects.filter(username=username).exists():
            User.objects.create_user(username=username, password=password, role=Role.OWNER)
            self.stdout.write(self.style.SUCCESS(f"owner '{username}' created"))

        token = os.environ.get("AGENT_TOKEN")
        if token:
            name = os.environ.get("LOCAL_SERVER_NAME", "dashboard-local")
            region = os.environ.get("LOCAL_SERVER_REGION", "محلی")
            server = Server.objects.filter(token_hash=hash_token(token)).first()
            if server is None:
                server = Server.objects.filter(name=name).first() or Server(name=name, region=region)
                server.set_token(token)
                server.save()
                self.stdout.write(self.style.SUCCESS(f"server '{name}' registered for local agent"))

        write_manifests()
