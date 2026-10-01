import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Client",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("rid", models.CharField(db_index=True, max_length=32, verbose_name="کد دستگاه")),
                ("uuid", models.CharField(db_index=True, max_length=128)),
                ("name", models.CharField(blank=True, max_length=128, verbose_name="نام کاربر")),
                ("hostname", models.CharField(blank=True, max_length=128, verbose_name="نام دستگاه")),
                ("os", models.CharField(blank=True, max_length=128, verbose_name="سیستم‌عامل")),
                ("cpu", models.CharField(blank=True, max_length=128)),
                ("memory", models.CharField(blank=True, max_length=32)),
                ("version", models.CharField(blank=True, max_length=32, verbose_name="نسخه")),
                ("ip", models.CharField(blank=True, max_length=64, verbose_name="IP")),
                ("country", models.CharField(blank=True, max_length=64, verbose_name="کشور")),
                ("city", models.CharField(blank=True, max_length=64, verbose_name="شهر")),
                ("first_seen", models.DateTimeField(blank=True, null=True, verbose_name="اولین بار")),
                ("last_seen", models.DateTimeField(blank=True, null=True, verbose_name="آخرین بار")),
                ("blocked", models.BooleanField(default=False, verbose_name="مسدود")),
                ("force_disconnect", models.BooleanField(default=False)),
                ("last_conns", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "کلاینت",
                "verbose_name_plural": "کلاینت‌ها",
                "ordering": ["-last_seen"],
            },
        ),
        migrations.CreateModel(
            name="ClientSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("conn_id", models.IntegerField(default=0)),
                ("session_id", models.CharField(blank=True, max_length=40)),
                ("peer_id", models.CharField(blank=True, max_length=32, verbose_name="کد طرف مقابل")),
                ("peer_name", models.CharField(blank=True, max_length=128, verbose_name="نام طرف مقابل")),
                ("conn_type", models.CharField(blank=True, max_length=32)),
                ("ip", models.CharField(blank=True, max_length=64)),
                ("started_at", models.DateTimeField(db_index=True)),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                ("bytes_in", models.BigIntegerField(blank=True, null=True)),
                ("bytes_out", models.BigIntegerField(blank=True, null=True)),
                ("client", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sessions", to="clients.client")),
            ],
            options={
                "verbose_name": "نشست",
                "verbose_name_plural": "نشست‌ها",
                "ordering": ["-started_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="client",
            constraint=models.UniqueConstraint(fields=("rid", "uuid"), name="uniq_client_rid_uuid"),
        ),
        migrations.AddIndex(
            model_name="clientsession",
            index=models.Index(fields=["client", "started_at"], name="clients_cli_client__e6f7a1_idx"),
        ),
        migrations.AddConstraint(
            model_name="clientsession",
            constraint=models.UniqueConstraint(fields=("client", "conn_id", "session_id"), name="uniq_client_session"),
        ),
    ]
