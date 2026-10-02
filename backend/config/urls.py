from django.contrib import admin
from django.urls import include, path

from monitoring.views import IngestView
from releases.views import ReleaseListView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/settings/", include("accounts.settings_urls")),
    path("api/settings/backups/", include("backups.urls")),
    path("api/settings/ha/", include("ha.urls")),
    path("api/monitoring/", include("monitoring.urls")),
    path("api/agent/ingest", IngestView.as_view()),
    path("api/releases", ReleaseListView.as_view()),
    path("api/releases/", include("releases.urls")),
    path("api/", include("clients.urls")),
]
