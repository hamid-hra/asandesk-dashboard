"""Web server settings (gunicorn). Every number can be changed from .env, see docker-compose.yml."""
import os

bind = "0.0.0.0:8000"
# The apps' heartbeats arrive all day from every installed device. Plain sync workers answer one request at a
# time, so a few slow uploads could block everything; threads let a worker keep serving while another request waits.
worker_class = "gthread"
workers = int(os.environ.get("WEB_CONCURRENCY", "4"))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
# release files and backups are streamed in one request
timeout = 600
graceful_timeout = 30
keepalive = 5
# restart workers now and then so a slow memory leak can never grow without limit
max_requests = 5000
max_requests_jitter = 500
worker_tmp_dir = "/dev/shm"
