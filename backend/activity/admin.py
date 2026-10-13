from django.contrib import admin

from .models import ActivityLog


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    """Read-only: the log is evidence, so nobody edits it from /admin either."""

    list_display = ("created_at", "username", "action", "text", "ok", "ip")
    list_filter = ("category", "ok")
    search_fields = ("username", "text")
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
