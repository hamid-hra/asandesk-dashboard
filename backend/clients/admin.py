from django import forms
from django.contrib import admin, messages

from .models import AccessToken, Account, Client, Ticket, TicketMessage


class AccountForm(forms.ModelForm):
    new_password = forms.CharField(
        label="رمز عبور جدید", required=False, widget=forms.PasswordInput(render_value=False),
        help_text="برای حساب جدید الزامی است. خالی بگذارید تا رمز فعلی تغییر نکند.",
    )

    class Meta:
        model = Account
        fields = ("email", "name", "plan", "is_active")

    def clean(self):
        data = super().clean()
        if not self.instance.pk and not data.get("new_password"):
            self.add_error("new_password", "رمز عبور را وارد کنید.")
        return data

    def save(self, commit=True):
        account = super().save(commit=False)
        if self.cleaned_data.get("new_password"):
            account.set_password(self.cleaned_data["new_password"])
        if commit:
            account.save()
        return account


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    form = AccountForm
    list_display = ("email", "name", "plan", "is_active", "last_login", "created_at")
    list_filter = ("plan", "is_active")
    search_fields = ("email", "name")

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if change and form.cleaned_data.get("new_password"):
            # با تغییر رمز همه دستگاه‌ها از حساب خارج می‌شوند
            AccessToken.objects.filter(account=obj).delete()
            Client.objects.filter(account=obj).update(account=None)


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("rd_id", "hostname", "os", "version", "account", "blocked", "last_seen")
    list_filter = ("blocked",)
    search_fields = ("rd_id", "hostname", "ip", "account__email")
    readonly_fields = ("hostname", "os_user", "os", "cpu", "memory", "version", "ip", "first_seen", "last_seen")
    actions = ["reset_device_key"]

    @admin.action(description="بازنشانی کلید دستگاه (برای نصب دوباره روی دستگاه دیگر با همان شناسه)")
    def reset_device_key(self, request, queryset):
        n = queryset.update(uuid_hash="")
        messages.info(request, f"کلید {n} دستگاه بازنشانی شد؛ اولین تماس بعدی کلید جدید را ثبت می‌کند.")


class MessageInline(admin.TabularInline):
    model = TicketMessage
    extra = 0
    readonly_fields = ("from_client", "author", "created_at")


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ("code", "subject", "client", "priority", "status", "created_at")
    list_filter = ("status", "priority")
    search_fields = ("subject", "client__rd_id")
    inlines = [MessageInline]
