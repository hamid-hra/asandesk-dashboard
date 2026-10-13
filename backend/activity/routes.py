"""Which panel actions land in the activity log, and how each one reads.

Key: ("app.ViewClass", HTTP method). Value: (action, label), or None for "never log this".
The label is a `str.format` template over `kw` (the URL parts) and `d` (the response body when it
is a dict), or a function `(kw, d) -> str`. A view can write a more specific line itself with
`activity.service.note`; sign-in and sign-out are logged from Django's auth signals instead.

A mutating request that is not listed here is still logged, with a generic line, so a new
endpoint can never change data silently.
"""

from collections.abc import Callable

Label = str | Callable[[dict, dict], str]


def _blocked(kw: dict, d: dict) -> str:
    return f"دستگاه {kw['rd_id']} را " + ("مسدود کرد" if d.get("blocked") else "از حالت مسدود درآورد")


def _ticket(kw: dict, d: dict) -> str:
    return str(d.get("code") or kw.get("pk"))


ROUTES: dict[tuple[str, str], tuple[str, Label] | None] = {
    # حساب. ورود و خروج را سیگنال‌های Django می‌نویسند (signals.py)، پس این درخواست‌ها دوبار ثبت نمی‌شوند
    ("accounts.LoginView", "POST"): None,
    ("accounts.LogoutView", "POST"): None,
    ("accounts.SetupView", "POST"): None,
    ("accounts.RecoveryResetView", "POST"): None,  # خود ویو می‌نویسد (کاربر هنوز وارد نشده است)
    ("accounts.PasswordChangeView", "POST"): None,  # خود ویو می‌نویسد
    ("accounts.RecoveryGenerateView", "POST"): ("auth.recovery_codes", "کدهای بازیابی تازه ساخت"),
    # نسخه‌ها
    ("releases.ReleaseListView", "POST"): ("release.create", "نسخهٔ {d[version]} را منتشر کرد"),
    ("releases.ReleaseDetailView", "PATCH"): ("release.update", "نسخهٔ {kw[version]} را ویرایش کرد"),
    ("releases.ReleaseDetailView", "DELETE"): ("release.delete", "نسخهٔ {kw[version]} را حذف کرد"),
    # کلاینت‌ها
    ("clients.ClientBlockView", "POST"): ("clients.block", _blocked),
    ("clients.ClientLogoutView", "POST"): ("clients.logout", "دستگاه {kw[rd_id]} را از حساب خارج کرد"),
    ("clients.ClientMessageView", "POST"): ("clients.message", "برای دستگاه {kw[rd_id]} پیام پشتیبانی فرستاد"),
    # بازخوردها
    ("clients.TicketDetailView", "PATCH"): (
        "tickets.status",
        lambda kw, d: f"وضعیت بازخورد {_ticket(kw, d)} را به «{d.get('status', '')}» تغییر داد",
    ),
    ("clients.TicketReplyView", "POST"): ("tickets.reply", lambda kw, d: f"به بازخورد {_ticket(kw, d)} پاسخ داد"),
    ("clients.TicketLogView", "GET"): ("tickets.log", "لاگ بازخورد {kw[pk]} را دانلود کرد"),
    # پشتیبان‌گیری
    ("backups.RunView", "POST"): ("backup.run", "پشتیبان‌گیری دستی را شروع کرد"),
    ("backups.RestoreView", "POST"): ("backup.restore", "بازگردانی پشتیبان شمارهٔ {kw[pk]} را شروع کرد"),
    ("backups.BackupDetailView", "DELETE"): ("backup.delete", "پشتیبان شمارهٔ {kw[pk]} را حذف کرد"),
    ("backups.DownloadView", "GET"): ("backup.download", "پشتیبان شمارهٔ {kw[pk]} را دانلود کرد"),
    ("backups.UploadView", "POST"): ("backup.upload", "فایل پشتیبان بارگذاری کرد"),
    ("backups.SettingsView", "PATCH"): ("backup.settings", "تنظیمات پشتیبان‌گیری را تغییر داد"),
    ("backups.OperationCancelView", "POST"): ("backup.cancel", "عملیات در جریان پشتیبان‌گیری/بازگردانی را لغو کرد"),
    ("backups.OperationDismissView", "POST"): None,
    # سرورهای HA
    ("ha.ConfigView", "PATCH"): ("ha.config", "تنظیمات failover را تغییر داد"),
    ("ha.ServerListView", "POST"): ("ha.server_draft", "افزودن سرور HA را شروع کرد"),
    ("ha.ServerConfirmView", "POST"): ("ha.server_add", "سرور HA را تأیید و اضافه کرد"),
    ("ha.ServerDetailView", "PATCH"): ("ha.server_update", "سرور HA شمارهٔ {kw[pk]} را ویرایش کرد"),
    ("ha.ServerDetailView", "DELETE"): ("ha.server_delete", "سرور HA شمارهٔ {kw[pk]} را حذف کرد"),
    ("ha.ServerTokenView", "POST"): ("ha.server_token", "توکن agent سرور HA شمارهٔ {kw[pk]} را تازه کرد"),
    ("ha.ServerPromoteView", "POST"): ("ha.server_promote", "سرور HA شمارهٔ {kw[pk]} را «اصلی» کرد"),
    ("ha.ServerCheckView", "POST"): None,
    # سرور و هشدارها
    ("monitoring.AlertAckView", "POST"): ("server.alert_ack", "یک هشدار را تأیید کرد"),
    ("monitoring.AlertAckAllView", "POST"): ("server.alert_ack", "همهٔ هشدارها را تأیید کرد"),
    # تنظیمات ← به‌روزرسانی پنل: خود ویوها خط دقیق‌تری می‌نویسند (ops/views.py)
    ("ops.UpdateCheckView", "POST"): None,
    ("ops.UpdateStartView", "POST"): None,
}

# درخواست‌های ثبت‌نشده با این عمل و یک خط عمومی نوشته می‌شوند
FALLBACK_ACTION = "other.request"


def render(label: Label | None, kw: dict, data: dict, fallback: str) -> str:
    """The text of a row; never raises (a missing field falls back to the generic line)."""
    if label is None:
        return fallback
    try:
        return label(kw, data) if callable(label) else label.format(kw=kw, d=data)
    except (KeyError, IndexError, TypeError, AttributeError):
        return fallback
