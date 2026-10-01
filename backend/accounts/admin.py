from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User

admin.site.site_header = "آسان‌دسک — مدیریت"
admin.site.site_title = "آسان‌دسک"
admin.site.index_title = "مدیریت کاربران و داده‌ها"


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "first_name", "last_name", "role", "is_active", "last_login")
    list_filter = ("role", "is_active")
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("اطلاعات شخصی", {"fields": ("first_name", "last_name", "email")}),
        ("دسترسی", {"fields": ("role", "is_active")}),
        ("تاریخ‌ها", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("username", "role", "password1", "password2")}),
    )
    readonly_fields = ("last_login", "date_joined")
