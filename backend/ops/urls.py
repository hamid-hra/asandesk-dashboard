from django.urls import path

from . import views

# زیر /api/settings/system/
urlpatterns = [
    path("update", views.UpdateStatusView.as_view()),
    path("update/check", views.UpdateCheckView.as_view()),
    path("update/start", views.UpdateStartView.as_view()),
    path("update/web", views.WebUpdateStatusView.as_view()),
    path("update/web/check", views.WebUpdateCheckView.as_view()),
    path("update/web/start", views.WebUpdateStartView.as_view()),
    path("update/agents", views.AgentsStatusView.as_view()),
    path("update/agents/check", views.AgentsCheckView.as_view()),
    path("update/agents/start", views.AgentsStartView.as_view()),
    path("logs/sources", views.LogSourcesView.as_view()),
    path("logs/services", views.ServicesView.as_view()),
    path("logs", views.LogsView.as_view()),
]
