from django.contrib import admin
from django.urls import include, path

from monitoring.views import IngestView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/monitoring/", include("monitoring.urls")),
    path("api/agent/ingest", IngestView.as_view()),
    path("api/releases/", include("releases.urls")),
]
