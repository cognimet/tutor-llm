#!/usr/bin/env bash
set -e
cd /app

# SQLite lives on a persisted volume, separate from the app's database/ dir
# (which holds migrations/seeders baked into the image).
DB_PATH="${DB_DATABASE:-/app/storage/db/database.sqlite}"
DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DB_DIR"
touch "$DB_PATH"

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
