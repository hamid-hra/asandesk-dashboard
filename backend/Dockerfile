FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STATIC_ROOT=/data/static \
    RELEASES_ROOT=/data/releases \
    BACKUPS_ROOT=/data/backups \
    SECRETS_DIR=/data/secrets \
    AGENT_TOKEN_FILE=/data/agent/token \
    FILE_UPLOAD_TEMP_DIR=/data/releases/.uploads

WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
ARG DEV=0
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --retries 10 --timeout 60 -r "$( [ "$DEV" = "1" ] && echo requirements-dev.txt || echo requirements.txt )"

COPY . .
RUN useradd --uid 1000 --create-home app \
    && mkdir -p /data/static /data/releases/.uploads /data/secrets /data/agent /data/backups \
    && chown -R app:app /data
USER app

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "600"]
