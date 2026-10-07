from django.urls import path

from . import views

urlpatterns = [
    path("csrf", views.CsrfView.as_view()),
    path("login", views.LoginView.as_view()),
    path("logout", views.LogoutView.as_view()),
    path("me", views.MeView.as_view()),
    path("setup", views.SetupView.as_view()),
    path("recovery", views.RecoveryStatusView.as_view()),
    path("recovery/generate", views.RecoveryGenerateView.as_view()),
    path("recovery/reset", views.RecoveryResetView.as_view()),
]
