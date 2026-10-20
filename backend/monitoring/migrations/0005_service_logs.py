import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("monitoring", "0004_server_peers_online_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="server",
            name="log_sources",
            field=models.JSONField(blank=True, default=dict, editable=False),
        ),
        migrations.CreateModel(
            name="ServiceLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("service", models.CharField(max_length=16)),
                ("ts", models.DateTimeField()),
                ("stream", models.CharField(default="out", max_length=4)),
                ("text", models.TextField()),
                ("server", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="logs", to="monitoring.server")),
            ],
            options={
                "indexes": [models.Index(fields=["server", "service", "id"], name="servicelog_tail_idx")],
            },
        ),
    ]
