from django.conf import settings
from django.db import models
from django.utils import timezone


class ActivityLog(models.Model):
    """One thing a signed-in person did in the panel (or a failed sign-in attempt).

    The name is copied into the row, so the history stays readable after the account is deleted
    or renamed. Rows are only ever added; old ones are removed by `service.purge`.
    """

    created_at = models.DateTimeField("زمان", default=timezone.now, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    username = models.CharField("نام کاربری", max_length=150, blank=True, db_index=True)
    display_name = models.CharField("نام", max_length=150, blank=True)
    action = models.CharField("عمل", max_length=64, db_index=True)  # مثل release.create
    category = models.CharField("بخش", max_length=24, db_index=True)  # بخش اول action
    text = models.CharField("شرح", max_length=400)
    ok = models.BooleanField("موفق", default=True)
    ip = models.CharField("IP", max_length=64, blank=True)

    class Meta:
        verbose_name = "فعالیت"
        verbose_name_plural = "لاگ فعالیت‌ها"
        ordering = ["-created_at", "-pk"]
        indexes = [models.Index(fields=["username", "-created_at"])]

    def __str__(self):
        return f"{self.username or '—'}: {self.text}"
