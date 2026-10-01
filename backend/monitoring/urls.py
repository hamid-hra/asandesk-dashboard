from django.urls import path

from . import views

urlpatterns = [
    path("overview", views.OverviewView.as_view()),
    path("live", views.LiveView.as_view()),
    path("status", views.StatusView.as_view()),
    path("alerts", views.AlertListView.as_view()),
    path("alerts/ack-all", views.AlertAckAllView.as_view()),
    path("alerts/<int:pk>/ack", views.AlertAckView.as_view()),
]
