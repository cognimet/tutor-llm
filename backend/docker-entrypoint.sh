#!/usr/bin/env bash
set -e
cd /app

# SQLite lives on a persisted volume, separate from the app's database/ dir
# (which holds migrations/seeders baked into the image).
DB_PATH="${DB_DATABASE:-/app/storage/db/database.sqlite}"
DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DB_DIR"
touch "$DB_PATH"

# IMPORTANT: `php artisan serve` strips nearly every environment variable when
# spawning its PHP workers (ServeCommand only passes a small whitelist through,
# so .env edits reload). Runtime env from docker-compose therefore NEVER
# reaches request handling — artisan CLI commands see it, HTTP requests don't.
# Symptom if unfixed: migrate/seed writes one SQLite file, requests read the
# empty skeleton DB at database/database.sqlite -> "Invalid credentials."
# Fix: persist the runtime config into .env, which the workers DO read.
env_put() {
  if grep -q "^$1=" .env 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}
env_put DB_CONNECTION "${DB_CONNECTION:-sqlite}"
env_put DB_DATABASE   "$DB_PATH"
env_put AI_SERVICE_URL "${AI_SERVICE_URL:-}"
env_put GEMINI_API_KEY "${GEMINI_API_KEY:-}"
env_put GEMINI_MODEL   "${GEMINI_MODEL:-gemini-2.5-flash}"
env_put GEMINI_MOCK    "${GEMINI_MOCK:-false}"
env_put FRONTEND_URL   "${FRONTEND_URL:-http://localhost:5173}"

# Generate app key if missing.
if ! grep -q "APP_KEY=base64" .env 2>/dev/null; then
  php artisan key:generate --force
fi

# Migrate + seed once. Marker lives next to the DB so it persists with the volume.
if [ ! -f "$DB_DIR/.seeded" ]; then
  php artisan migrate:fresh --seed --force
  touch "$DB_DIR/.seeded"
  echo "✅ Seeded demo accounts (password: password): admin@tuto.ai · student@tuto.ai · parent@tuto.ai"
else
  php artisan migrate --force || true
fi

echo "🚀 Laravel API on http://localhost:8000"
exec php artisan serve --host=0.0.0.0 --port=8000
