from django.urls import path

from . import panel

# زیر /api/ (پنل مالک)
urlpatterns = [
    path("webusers", panel.WebUserListView.as_view()),
    path("webusers/<int:pk>", panel.WebUserDetailView.as_view()),
    path("webusers/<int:pk>/block", panel.WebUserBlockView.as_view()),
    path("webusers/<int:pk>/password", panel.WebUserPasswordView.as_view()),
]
