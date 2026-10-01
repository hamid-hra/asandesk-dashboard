#!/bin/sh
set -e
mkdir -p "${RELEASES_ROOT:-/data/releases}/.uploads"
python manage.py migrate --noinput
python manage.py collectstatic --noinput >/dev/null
python manage.py bootstrap
exec "$@"
