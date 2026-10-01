from django.contrib import admin

from .models import Client, ClientSession


class SessionInline(admin.TabularInline):
    model = ClientSession
    extra = 0
    can_delete = False
    readonly_fields = ("conn_id", "peer_id", "peer_name", "conn_type", "ip", "started_at", "ended_at")
    fields = readonly_fields
    ordering = ("-started_at",)

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("display_name", "rid", "os", "version", "ip", "location", "blocked", "last_seen")
    list_filter = ("blocked", "os")
    search_fields = ("rid", "name", "hostname", "ip")
    readonly_fields = ("rid", "uuid", "name", "hostname", "os", "cpu", "memory", "version",
                       "ip", "city", "country", "first_seen", "last_seen", "last_conns", "created_at")
    inlines = [SessionInline]
    actions = ["block", "unblock"]

    @admin.action(description="مسدود کردن")
    def block(self, request, queryset):
        queryset.update(blocked=True)

    @admin.action(description="رفع مسدودیت")
    def unblock(self, request, queryset):
        queryset.update(blocked=False)
