from django.urls import path

from . import views

urlpatterns = [
    path("", views.ReleaseListView.as_view()),
    path("stats", views.ReleaseStatsView.as_view()),
    path("<str:version>/download/<str:platform>", views.download),
]
