from django.urls import path

from . import views

urlpatterns = [
    path("stats", views.ReleaseStatsView.as_view()),
    path("<str:version>/download/<str:platform>", views.download),
]
