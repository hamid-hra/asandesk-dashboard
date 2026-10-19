from django.contrib import admin
from django.urls import include, path

from monitoring.views import IngestView, PeersIngestView
from releases.views import ReleaseListView

from .search import SearchView
from .views import VersionView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/version", VersionView.as_view()),
    path("api/auth/", include("accounts.urls")),
    path("api/settings/", include("accounts.settings_urls")),
    path("api/settings/backups/", include("backups.urls")),
    path("api/settings/ha/", include("ha.urls")),
    path("api/settings/system/", include("ops.urls")),
    path("api/settings/", include("activity.urls")),
    path("api/monitoring/", include("monitoring.urls")),
    path("api/agent/ingest", IngestView.as_view()),
    path("api/agent/peers", PeersIngestView.as_view()),
    path("api/releases", ReleaseListView.as_view()),
    path("api/releases/", include("releases.urls")),
    path("api/", include("notices.urls")),
    path("api/search", SearchView.as_view()),
    path("api/", include("clients.urls")),
]
