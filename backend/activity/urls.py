from django.urls import path

from . import views

# زیر /api/settings/
urlpatterns = [
    path("activity", views.ActivityListView.as_view()),
]
