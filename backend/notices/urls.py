from django.urls import path

from . import views

# زیر /api/
urlpatterns = [
    path("notices", views.InboxView.as_view()),
    path("notices/read-all", views.ReadAllView.as_view()),
    path("notices/<int:pk>/read", views.ReadView.as_view()),
    path("settings/notices", views.ManageListView.as_view()),
    path("settings/notices/<int:pk>", views.ManageDetailView.as_view()),
]
