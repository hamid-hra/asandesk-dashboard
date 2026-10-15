from django.db import migrations, models


def pending_to_closed(apps, schema_editor):
    """«پاسخ داده شد» حذف شد؛ آن بازخوردها «بررسی‌شده» حساب می‌شوند."""
    apps.get_model("clients", "Ticket").objects.filter(status="pending").update(status="closed")


class Migration(migrations.Migration):

    dependencies = [
        ("clients", "0004_ticketimage"),
    ]

    operations = [
        migrations.AddField(
            model_name="client",
            name="revoked_at",
            field=models.DateTimeField(
                blank=True, editable=False, null=True, verbose_name="زمان پاک شدن اطلاعات سرور"
            ),
        ),
        migrations.RunPython(pending_to_closed, migrations.RunPython.noop),
        migrations.RemoveField(model_name="ticket", name="first_response_at"),
        migrations.AlterField(
            model_name="ticket",
            name="status",
            field=models.CharField(
                choices=[("open", "جدید"), ("closed", "بررسی‌شده")],
                default="open",
                max_length=8,
                verbose_name="وضعیت",
            ),
        ),
    ]
