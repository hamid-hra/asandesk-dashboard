from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("monitoring", "0002_server_pubkey_fp"),
    ]

    operations = [
        migrations.AddField(
            model_name="server",
            name="services",
            field=models.JSONField(blank=True, default=dict, editable=False),
        ),
        migrations.AddField(
            model_name="server",
            name="services_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
    ]
