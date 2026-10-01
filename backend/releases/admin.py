from django.contrib import admin

from .models import Release, ReleaseAsset
from .services import remember_base_url, write_manifests


class AssetInline(admin.TabularInline):
    model = ReleaseAsset
    extra = 0
    readonly_fields = ("size", "sha256")


@admin.register(Release)
class ReleaseAdmin(admin.ModelAdmin):
    list_display = ("version", "channel", "published_on", "mandatory", "rollout", "downloads")
    list_filter = ("channel",)
    inlines = [AssetInline]

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        remember_base_url(request)
        write_manifests()
