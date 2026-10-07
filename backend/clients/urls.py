from django.urls import path

from . import client_api, views

# زیر /api/
urlpatterns = [
    # پنل
    path("clients", views.ClientListView.as_view()),
    path("clients/stats", views.ClientStatsView.as_view()),
    path("clients/<str:rd_id>", views.ClientDetailView.as_view()),
    path("clients/<str:rd_id>/block", views.ClientBlockView.as_view()),
    path("clients/<str:rd_id>/logout", views.ClientLogoutView.as_view()),
    path("clients/<str:rd_id>/message", views.ClientMessageView.as_view()),
    path("tickets", views.TicketListView.as_view()),
    path("tickets/stats", views.TicketStatsView.as_view()),
    path("tickets/<int:pk>", views.TicketDetailView.as_view()),
    path("tickets/<int:pk>/reply", views.TicketReplyView.as_view()),
    path("tickets/<int:pk>/log", views.TicketLogView.as_view()),
    # اپلیکیشن آسان‌دسک (سازگار با API سرور RustDesk؛ client_api.py)
    path("heartbeat", client_api.HeartbeatView.as_view()),
    path("sysinfo", client_api.SysinfoView.as_view()),
    path("sysinfo_ver", client_api.SysinfoVerView.as_view()),
    path("audit/conn", client_api.AuditConnView.as_view()),
    path("audit/<str:kind>", client_api.AuditIgnoreView.as_view()),
    path("login", client_api.LoginView.as_view()),
    path("currentUser", client_api.CurrentUserView.as_view()),
    path("logout", client_api.LogoutView.as_view()),
    path("login-options", client_api.login_options),
    path("client/feedback", client_api.ClientFeedbackView.as_view()),
    path("client/tickets/list", client_api.ClientTicketListView.as_view()),
    path("client/tickets/new", client_api.ClientTicketCreateView.as_view()),
    path("client/tickets/<int:pk>/reply", client_api.ClientTicketReplyView.as_view()),
]
