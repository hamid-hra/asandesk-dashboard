from django.contrib import admin, messages

from .models import Alert, Server


@admin.register(Server)
class ServerAdmin(admin.ModelAdmin):
    list_display = ("name", "region", "ip", "hostname", "maintenance", "last_seen")
    readonly_fields = ("hostname", "cores", "ram_total", "disk_total", "net_capacity_bps", "agent_version",
                       "first_seen", "last_seen")
    actions = ["rotate_token"]

    def save_model(self, request, obj, form, change):
        token = None
        if not obj.token_hash:
            token = obj.set_token()
        super().save_model(request, obj, form, change)
        if token:
            messages.warning(request, f"توکن agent این سرور (فقط همین یک بار نمایش داده می‌شود): {token}")

    @admin.action(description="ساخت توکن جدید agent")
    def rotate_token(self, request, queryset):
        for server in queryset:
            token = server.set_token()
            server.save(update_fields=["token_hash"])
            messages.warning(request, f"{server.name}: {token}")


@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ("title", "level", "server", "opened_at", "resolved_at", "acked_at")
    list_filter = ("level", "kind")
