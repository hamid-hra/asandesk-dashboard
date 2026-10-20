from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clients", "0007_client_legacy"),
    ]

    operations = [
        migrations.AddIndex(model_name="client", index=models.Index(fields=["last_seen"], name="client_last_seen_idx")),
        migrations.AddIndex(model_name="client", index=models.Index(fields=["first_seen"], name="client_first_seen_idx")),
        migrations.AddIndex(model_name="client", index=models.Index(fields=["legacy"], name="client_legacy_idx")),
    ]
