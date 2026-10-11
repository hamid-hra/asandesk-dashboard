from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import Ticket, TicketImage


@receiver(post_delete, sender=Ticket)
def delete_feedback_log(sender, instance, **kwargs):
    """حذف بازخورد (یا کلاینتش) فایل لاگ را هم از دیسک پاک می‌کند."""
    if instance.log_file:
        instance.log_file.delete(save=False)


@receiver(post_delete, sender=TicketImage)
def delete_feedback_image(sender, instance, **kwargs):
    """حذف بازخورد، تصویرهای پیوستش را هم از دیسک پاک می‌کند (حذف آبشاری هم این سیگنال را می‌فرستد)."""
    if instance.file:
        instance.file.delete(save=False)
