from django.contrib import admin

from .models import Notice


@admin.register(Notice)
class NoticeAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "popup", "version", "created_by", "created_at", "expires_at")
    list_filter = ("kind", "popup")
    search_fields = ("title", "body")
