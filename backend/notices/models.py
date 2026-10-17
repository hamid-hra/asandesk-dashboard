from django.conf import settings
from django.db import models
from django.utils import timezone


class Kind(models.TextChoices):
    INFO = "info", "اطلاعیه"
    UPDATE = "update", "به‌روزرسانی"
    WARNING = "warning", "هشدار"


class Notice(models.Model):
    """A message for the panel's own users (not app clients).

    Sent by someone who manages users, or created by the panel itself once per panel version
    (`version` set, `items` = that version's changelog). Every recipient sees it in the bell menu;
    with `popup` it also opens as a window the next time they open the panel, until they dismiss it.
    """

    title = models.CharField("عنوان", max_length=120)
    body = models.TextField("متن", max_length=4000, blank=True)
    kind = models.CharField("نوع", max_length=12, choices=Kind.choices, default=Kind.INFO)
    popup = models.BooleanField("نمایش در ورود بعدی", default=True)
    # نسخهٔ پنل برای اعلان خودکار «پنل به‌روز شد» (یکی برای هر نسخه)
    version = models.CharField(max_length=32, null=True, blank=True, unique=True)
    items = models.JSONField("تغییرات", default=list, blank=True)
    # خالی = همهٔ کاربران پنل
    recipients = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="+")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField("زمان", default=timezone.now, db_index=True)
    expires_at = models.DateTimeField("پایان نمایش", null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        verbose_name = "اعلان"
        verbose_name_plural = "اعلان‌ها"

    def __str__(self):
        return self.title


class NoticeRead(models.Model):
    notice = models.ForeignKey(Notice, on_delete=models.CASCADE, related_name="reads")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    read_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["notice", "user"], name="notice_read_once")]
