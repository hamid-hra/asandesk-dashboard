from django.contrib import admin

from .models import WebUser


@admin.register(WebUser)
class WebUserAdmin(admin.ModelAdmin):
    list_display = ("username", "first_name", "last_name", "email", "phone", "web_id", "is_blocked", "created_at")
    search_fields = ("username", "first_name", "last_name", "email", "phone", "web_id")
    list_filter = ("is_blocked",)
    exclude = ("password",)
    readonly_fields = ("web_id", "created_at", "last_login_at", "last_seen_at", "last_ip", "signup_ip")
