from django.core.management.base import BaseCommand

from releases import signing


class Command(BaseCommand):
    help = "Show the public key that signs update.json (creates the key on first use). --private prints the seed for an offline backup."

    def add_arguments(self, parser):
        parser.add_argument("--private", action="store_true", help="also print the private seed (keep it secret)")

    def handle(self, *args, **opts):
        self.stdout.write(f"public key (put it in src/asandesk.rs, UPDATE_SIGNING_KEYS): {signing.public_key_b64()}")
        self.stdout.write(f"key file: {signing.key_path()}")
        if opts["private"]:
            self.stdout.write(f"private seed (offline backup only, never share): {signing.seed_b64()}")
