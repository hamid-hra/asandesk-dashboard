from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("clients", "0005_block_wipe_feedback_only"),
    ]

    operations = [
        migrations.AddField(
            model_name="connsession",
            name="result",
            field=models.CharField(blank=True, default="", max_length=12),
        ),
    ]
