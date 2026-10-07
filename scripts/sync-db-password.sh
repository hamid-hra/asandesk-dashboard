#!/usr/bin/env sh
# Makes the PostgreSQL password match POSTGRES_PASSWORD in .env.
#
# Why: POSTGRES_PASSWORD is applied only when the database volume is created for the
# first time. If you delete the project folder and install again with a new .env, the
# old volume (asandesk-dashboard_pgdata) is kept with the old password and the backend
# fails with "password authentication failed for user".
#
# The old password is NOT needed: inside the db container, psql connects through the
# local socket, which the official postgres image trusts. Data is kept.
#
#   sh scripts/sync-db-password.sh
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "فایل .env پیدا نشد. اول آن را بسازید (cp .env.example .env)."; exit 1; }

docker compose up -d db

echo "منتظر آماده شدن دیتابیس..."
tries=0
until docker compose exec -T db sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; do
  tries=$((tries + 1))
  [ "$tries" -le 60 ] || { echo "دیتابیس بالا نیامد. docker compose logs db را ببینید."; exit 1; }
  sleep 1
done

# The new password comes from the container's own environment (compose reads it from .env),
# so it never appears in the shell history or the process list of the host.
docker compose exec -T db sh -c \
  'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v "usr=$POSTGRES_USER" -v "pw=$POSTGRES_PASSWORD"' <<'SQL'
ALTER USER :"usr" WITH PASSWORD :'pw';
SQL

echo "رمز دیتابیس با .env یکی شد. بالا آوردن بقیهٔ سرویس‌ها..."
docker compose up -d --build
echo "تمام شد."
