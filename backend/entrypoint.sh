#!/bin/sh
set -e
SECRETS_DIR="${SECRETS_DIR:-/data/secrets}"
mkdir -p "${RELEASES_ROOT:-/data/releases}/.uploads" "$SECRETS_DIR"

# کلید Django بار اول ساخته و روی volume نگه داشته می‌شود (نیازی به .env نیست)
if [ -z "$DJANGO_SECRET_KEY" ] && [ ! -s "$SECRETS_DIR/django_secret_key" ]; then
    umask 077
    python -c "import secrets; print(secrets.token_urlsafe(50))" > "$SECRETS_DIR/django_secret_key"
    umask 022
fi

python manage.py migrate --noinput
python manage.py collectstatic --noinput >/dev/null
python manage.py bootstrap
exec "$@"
