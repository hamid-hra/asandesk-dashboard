from django.urls import path

from . import users_api

# زیر /api/settings/
urlpatterns = [
    path("users", users_api.UserListView.as_view()),
    path("users/<int:pk>", users_api.UserDetailView.as_view()),
]
