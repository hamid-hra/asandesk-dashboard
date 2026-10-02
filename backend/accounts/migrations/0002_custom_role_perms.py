from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="perms",
            field=models.JSONField(blank=True, default=dict, verbose_name="دسترسی بخش‌ها"),
        ),
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[("owner", "مالک"), ("admin", "مدیر"), ("viewer", "ناظر"), ("custom", "سفارشی")],
                default="viewer",
                max_length=16,
                verbose_name="نقش",
            ),
        ),
    ]
