"""دستورهایی که پنل برای نصب و تنظیم agent (ریپوی Asan-desk-agent) نشان می‌دهد."""

# اختیاری: آنلاین بودن دستگاه‌های قدیمی. فقط کانتینر ایجنت host network و NET_RAW می‌گیرد؛ hbbs/hbbr دست نمی‌خورند
ONLINE_COMMAND = (
    "cd Asan-desk-agent && "
    "(grep -q '^COMPOSE_FILE=' .env || echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.sniff.yml' >> .env) && "
    "docker compose up -d"
)
