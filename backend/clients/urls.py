from django.urls import path

from . import views

# مسیرهای جزئیات/فرمان پنل (پشت لاگین). فهرست و مسیرهای دریافتِ کلاینت در
# config/urls.py هستند.
urlpatterns = [
    path("<int:pk>", views.ClientDetailView.as_view()),
    path("<int:pk>/disconnect", views.ClientDisconnectView.as_view()),
    path("<int:pk>/block", views.ClientBlockView.as_view()),
]
