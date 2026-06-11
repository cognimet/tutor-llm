#!/usr/bin/env bash
set -e
cd /app

# IMPORTANT: `php artisan serve` strips nearly every environment variable when
# spawning its PHP request workers (only a small whitelist passes through, so
# .env edits reload). Runtime env from docker-compose therefore reaches artisan
# CLI commands (migrate/seed) but NOT HTTP request handling. Persist the
# runtime config into .env, which the workers DO read — otherwise a custom
# DB_PASSWORD/INTERNAL_API_KEY in compose silently diverges at request time.
env_put() {
  if grep -q "^$1=" .env 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}
env_put DB_CONNECTION  "${DB_CONNECTION:-pgsql}"
env_put DB_HOST        "${DB_HOST:-postgres}"
env_put DB_PORT        "${DB_PORT:-5432}"
env_put DB_DATABASE    "${DB_DATABASE:-aitutor}"
env_put DB_USERNAME    "${DB_USERNAME:-aitutor}"
env_put DB_PASSWORD    "${DB_PASSWORD:-aitutor}"
env_put REDIS_HOST     "${REDIS_HOST:-redis}"
env_put REDIS_PORT     "${REDIS_PORT:-6379}"
env_put AI_SERVICE_URL "${AI_SERVICE_URL:-http://ai-service:8001}"
env_put AI_SERVICE_KEY "${AI_SERVICE_KEY:-dev-internal-key}"
env_put FRONTEND_URL   "${FRONTEND_URL:-http://localhost:5173}"

# Generate app key if missing.
if ! grep -q "APP_KEY=base64" .env 2>/dev/null; then
  php artisan key:generate --force
fi

DB_CONNECTION="${DB_CONNECTION:-pgsql}"

if [ "$DB_CONNECTION" = "pgsql" ]; then
  # Wait for Postgres to accept connections before migrating.
  echo "⏳ Waiting for Postgres at ${DB_HOST:-postgres}:${DB_PORT:-5432}…"
  until pg_isready -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USERNAME:-aitutor}" >/dev/null 2>&1; do
    sleep 1
  done
  echo "✅ Postgres is ready."

  # Seed only once; a marker row in a tiny table tells us if we've run.
  if ! php artisan migrate:status >/dev/null 2>&1; then
    php artisan migrate:fresh --seed --force
    echo "✅ Seeded demo accounts (password: password): admin@tuto.ai · student@tuto.ai · parent@tuto.ai"
    # Index seeded curriculum content into the vector store (non-fatal — the
    # indexer degrades gracefully if the AI service/Qdrant aren't ready yet).
    php artisan rag:index --pending || echo "⚠️  RAG index skipped (run 'php artisan rag:index' later)."
  else
    php artisan migrate --force || true
    php artisan rag:index --pending || true
  fi
else
  # SQLite fallback (local, no Postgres).
  DB_PATH="${DB_DATABASE:-/app/storage/db/database.sqlite}"
  env_put DB_DATABASE "$DB_PATH"   # override the pgsql-style default written above
  DB_DIR="$(dirname "$DB_PATH")"
  mkdir -p "$DB_DIR"
  touch "$DB_PATH"
  if [ ! -f "$DB_DIR/.seeded" ]; then
    php artisan migrate:fresh --seed --force
    touch "$DB_DIR/.seeded"
    echo "✅ Seeded demo accounts (password: password): admin@tuto.ai · student@tuto.ai · parent@tuto.ai"
  else
    php artisan migrate --force || true
  fi
fi

echo "🚀 Laravel API on http://localhost:8000"
exec php artisan serve --host=0.0.0.0 --port=8000
