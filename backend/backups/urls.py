from django.urls import path

from . import views

# زیر /api/settings/backups/
urlpatterns = [
    path("", views.OverviewView.as_view()),
    path("settings", views.SettingsView.as_view()),
    path("run", views.RunView.as_view()),
    path("upload", views.UploadView.as_view()),
    path("operation", views.OperationView.as_view()),
    path("operation/<int:pk>/cancel", views.OperationCancelView.as_view()),
    path("operation/<int:pk>/dismiss", views.OperationDismissView.as_view()),
    path("<int:pk>", views.BackupDetailView.as_view()),
    path("<int:pk>/restore", views.RestoreView.as_view()),
    path("<int:pk>/download", views.DownloadView.as_view()),
]
