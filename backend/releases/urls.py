from django.urls import path

from . import views

urlpatterns = [
    path("stats", views.ReleaseStatsView.as_view()),
    path("<str:version>/download/<str:platform>", views.download),
    # نام فایل انتهای مسیر (برای آپدیت خودکار کلاینت)؛ در ویو نادیده گرفته می‌شود
    path("<str:version>/download/<str:platform>/<path:filename>", views.download),
]
