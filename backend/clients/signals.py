from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import Ticket


@receiver(post_delete, sender=Ticket)
def delete_feedback_log(sender, instance, **kwargs):
    """حذف بازخورد (یا کلاینتش) فایل لاگ را هم از دیسک پاک می‌کند."""
    if instance.log_file:
        instance.log_file.delete(save=False)
