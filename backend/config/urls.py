from django.contrib import admin
from django.urls import include, path

from clients.views import AuditConnView, ClientListView, HeartbeatView, SysinfoVerView, SysinfoView
from monitoring.views import IngestView
from releases.views import ReleaseListView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/monitoring/", include("monitoring.urls")),
    path("api/agent/ingest", IngestView.as_view()),
    path("api/releases", ReleaseListView.as_view()),
    path("api/releases/", include("releases.urls")),
    # گزارش کلاینت (خود کلاینت این مسیرها را صدا می‌زند؛ بدون لاگین)
    path("api/heartbeat", HeartbeatView.as_view()),
    path("api/sysinfo", SysinfoView.as_view()),
    path("api/sysinfo_ver", SysinfoVerView.as_view()),
    path("api/audit/conn", AuditConnView.as_view()),
    # پنل کلاینت‌ها (پشت لاگین)
    path("api/clients", ClientListView.as_view()),
    path("api/clients/", include("clients.urls")),
]
