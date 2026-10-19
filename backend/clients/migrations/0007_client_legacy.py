from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clients", "0006_connsession_result"),
    ]

    operations = [
        migrations.AddField(
            model_name="client",
            name="legacy",
            field=models.BooleanField(default=False, verbose_name="قدیمی (بدون API)"),
        ),
    ]
