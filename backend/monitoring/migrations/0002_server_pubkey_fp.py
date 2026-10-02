from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("monitoring", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="server",
            name="pubkey_fp",
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
    ]
