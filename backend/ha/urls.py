from django.urls import path

from . import views

# زیر /api/settings/ha/
urlpatterns = [
    path("", views.OverviewView.as_view()),
    path("config", views.ConfigView.as_view()),
    path("servers", views.ServerListView.as_view()),
    path("servers/<int:pk>", views.ServerDetailView.as_view()),
    path("servers/<int:pk>/confirm", views.ServerConfirmView.as_view()),
    path("servers/<int:pk>/token", views.ServerTokenView.as_view()),
    path("servers/<int:pk>/check", views.ServerCheckView.as_view()),
    path("servers/<int:pk>/promote", views.ServerPromoteView.as_view()),
]
