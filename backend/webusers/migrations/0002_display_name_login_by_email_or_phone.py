"""نام و نام خانوادگی → «نام نمایشی» اختیاری؛ نام کاربری حذف؛ ورود با ایمیل یا موبایل (دست‌کم یکی).

حساب‌های موجود هر دو را دارند، پس با همان ایمیل یا موبایل وارد می‌شوند و نامشان نام نمایشی می‌شود.
"""

from django.db import migrations, models


def names_to_display_name(apps, schema_editor):
    WebUser = apps.get_model("webusers", "WebUser")
    for u in WebUser.objects.only("pk", "first_name", "last_name"):
        name = f"{u.first_name} {u.last_name}".strip()[:64]
        WebUser.objects.filter(pk=u.pk).update(display_name=name)


class Migration(migrations.Migration):
    dependencies = [
        ("webusers", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="webuser",
            name="display_name",
            field=models.CharField(blank=True, max_length=64, verbose_name="نام نمایشی"),
        ),
        migrations.RunPython(names_to_display_name, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="webuser",
            name="email",
            field=models.CharField(blank=True, max_length=254, null=True, unique=True, verbose_name="ایمیل"),
        ),
        migrations.AlterField(
            model_name="webuser",
            name="phone",
            field=models.CharField(blank=True, max_length=16, null=True, unique=True, verbose_name="موبایل"),
        ),
        migrations.RemoveField(model_name="webuser", name="first_name"),
        migrations.RemoveField(model_name="webuser", name="last_name"),
        migrations.RemoveField(model_name="webuser", name="username"),
        migrations.AddConstraint(
            model_name="webuser",
            constraint=models.CheckConstraint(
                condition=models.Q(("email__isnull", False), ("phone__isnull", False), _connector="OR"),
                name="webuser_email_or_phone",
            ),
        ),
    ]
