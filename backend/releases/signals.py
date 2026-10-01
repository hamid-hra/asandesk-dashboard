from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import Release, ReleaseAsset
from .services import write_manifests


@receiver(post_delete, sender=ReleaseAsset)
def delete_asset_file(sender, instance, **kwargs):
    if instance.file:
        instance.file.delete(save=False)


@receiver(post_delete, sender=Release)
def refresh_manifests(sender, instance, **kwargs):
    # حذف نسخه از /admin باید latest.json را هم به‌روز کند
    transaction.on_commit(write_manifests)
