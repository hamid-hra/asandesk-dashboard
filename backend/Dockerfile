FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STATIC_ROOT=/data/static \
    RELEASES_ROOT=/data/releases \
    FILE_UPLOAD_TEMP_DIR=/data/releases/.uploads

WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
ARG DEV=0
RUN if [ "$DEV" = "1" ]; then pip install -r requirements-dev.txt; else pip install -r requirements.txt; fi

COPY . .
RUN useradd --uid 1000 --create-home app \
    && mkdir -p /data/static /data/releases/.uploads \
    && chown -R app:app /data
USER app

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "600"]
