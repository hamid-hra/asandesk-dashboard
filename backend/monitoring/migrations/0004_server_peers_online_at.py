from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("monitoring", "0003_server_services"),
    ]

    operations = [
        migrations.AddField(
            model_name="server",
            name="peers_online_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
    ]
