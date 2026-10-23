from django.urls import path

from . import views

# زیر /api/web/ (برنامهٔ وب)
urlpatterns = [
    path("config", views.config),
    path("auth/register", views.register),
    path("auth/login", views.login),
    path("auth/logout", views.logout),
    path("me", views.me),
    path("me/password", views.change_password),
    path("me/peer", views.peer),
    path("me/peer-key", views.peer_key),
    path("devices", views.devices),
    path("devices/<str:peer_id>", views.device_detail),
    path("connections", views.connections),
    path("connections/<int:pk>/end", views.connection_end),
]
