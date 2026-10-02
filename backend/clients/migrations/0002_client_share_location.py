from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clients", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="client",
            name="share_location",
            field=models.BooleanField(default=False, verbose_name="اجازهٔ ثبت IP"),
        ),
    ]
