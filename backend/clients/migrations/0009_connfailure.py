import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clients", "0008_client_indexes"),
    ]

    operations = [
        migrations.CreateModel(
            name="ConnFailure",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("peer_id", models.CharField(blank=True, max_length=32)),
                ("reason", models.CharField(max_length=24)),
                ("detail", models.CharField(blank=True, max_length=200)),
                ("conn_type", models.CharField(blank=True, max_length=12)),
                ("version", models.CharField(blank=True, max_length=32)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                (
                    "client",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="conn_failures", to="clients.client"
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
