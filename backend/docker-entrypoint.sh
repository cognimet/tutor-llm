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
env_put AI_SERVICE_TIMEOUT "${AI_SERVICE_TIMEOUT:-180}"
env_put FRONTEND_URL   "${FRONTEND_URL:-http://localhost:5173}"
# Async post-turn processing (signals/graph/summary/decay) runs on the queue.
env_put QUEUE_CONNECTION "${QUEUE_CONNECTION:-database}"
# Billing / payments — `php artisan serve` strips env, so persist to .env.
env_put BILLING_PROVIDER   "${BILLING_PROVIDER:-manual}"
env_put BILLING_INR_PER_USD "${BILLING_INR_PER_USD:-83}"
env_put RAZORPAY_KEY_ID    "${RAZORPAY_KEY_ID:-}"
env_put RAZORPAY_KEY_SECRET "${RAZORPAY_KEY_SECRET:-}"
env_put RAZORPAY_WEBHOOK_SECRET "${RAZORPAY_WEBHOOK_SECRET:-}"
env_put PAYPAL_CLIENT_ID   "${PAYPAL_CLIENT_ID:-}"
env_put PAYPAL_CLIENT_SECRET "${PAYPAL_CLIENT_SECRET:-}"
env_put PAYPAL_MODE        "${PAYPAL_MODE:-sandbox}"
env_put PAYPAL_WEBHOOK_ID  "${PAYPAL_WEBHOOK_ID:-}"
env_put PAYPAL_CURRENCY    "${PAYPAL_CURRENCY:-USD}"

# Block until the Python AI service is accepting connections, so the first-boot
# `rag:index` doesn't race ahead of it and silently skip embedding (compose only
# waits for the ai-service container to START, not to be ready). The backend
# image has no curl/wget, so probe the TCP port with bash's /dev/tcp. Derive
# host:port from AI_SERVICE_URL (default ai-service:8001).
wait_for_ai_service() {
  local url="${AI_SERVICE_URL:-http://ai-service:8001}"
  local hostport="${url#*://}"; hostport="${hostport%%/*}"
  local host="${hostport%%:*}" port="${hostport##*:}"
  [ "$host" = "$port" ] && port=8001
  echo "⏳ Waiting for AI service at ${host}:${port}…"
  for _ in $(seq 1 90); do
    if (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
      exec 3>&- 3<&- 2>/dev/null || true
      echo "✅ AI service reachable."
      return 0
    fi
    sleep 2
  done
  echo "⚠️  AI service unreachable after 180s — indexing may be skipped (it self-heals on the next boot via 'rag:index --pending')."
  return 1
}

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

  # ── Create + seed ONCE; never wipe an existing database. ────────────────
  # The probe is a direct, deterministic check for the `migrations` table via
  # psql (the old `artisan migrate:status` probe treated ANY failure — even a
  # transient one — as "empty DB", which could trigger a destructive
  # migrate:fresh). Set DB_FRESH=true in the environment to wipe + reseed
  # explicitly when you want a clean slate.
  HAS_MIGRATIONS_TABLE="$(PGPASSWORD="${DB_PASSWORD:-aitutor}" psql -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" \
      -U "${DB_USERNAME:-aitutor}" -d "${DB_DATABASE:-aitutor}" -tAc \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='migrations'" 2>/dev/null || echo "probe_failed")"

  if [ "$HAS_MIGRATIONS_TABLE" = "probe_failed" ]; then
    echo "⚠️  Could not probe the database — starting WITHOUT migrating (data preserved)."
    echo "    Check DB credentials, then run: docker compose exec backend php artisan migrate"
  elif [ "${DB_FRESH:-false}" = "true" ]; then
    echo "🧨 DB_FRESH=true — wiping and reseeding the database…"
    php artisan migrate:fresh --seed --force
    echo "✅ Seeded demo accounts (password: password): admin@tuto.ai · student@tuto.ai · parent@tuto.ai"
    wait_for_ai_service || true
    php artisan rag:index || echo "⚠️  RAG index skipped (run 'php artisan rag:index' later)."
    php artisan graph:sync || echo "⚠️  Graph sync skipped (run 'php artisan graph:sync' later)."
  elif [ "$HAS_MIGRATIONS_TABLE" = "0" ]; then
    echo "🆕 Fresh database detected — first-time create + seed…"
    php artisan migrate --seed --force
    echo "✅ Seeded demo accounts (password: password): admin@tuto.ai · student@tuto.ai · parent@tuto.ai"
    # Index seeded curriculum into the vector store (non-fatal).
    wait_for_ai_service || true
    php artisan rag:index || echo "⚠️  RAG index skipped (run 'php artisan rag:index' later)."
    php artisan graph:sync || echo "⚠️  Graph sync skipped (run 'php artisan graph:sync' later)."
  else
    echo "♻️  Existing database detected — incremental migrations only (no reseed, data preserved)."
    php artisan migrate --force || true
    # Catch up any chunks that weren't indexed on a previous boot (self-healing).
    wait_for_ai_service || true
    php artisan rag:index --pending || true
    php artisan graph:sync --pending || true
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

# Public storage symlink so uploaded files (e.g. profile avatars under
# storage/app/public) are served at /storage/*. Idempotent; --force replaces a
# stale link left in the image.
php artisan storage:link --force >/dev/null 2>&1 || true

# Background queue worker for async post-turn processing. Restarts itself if it
# exits (e.g. after --max-time) so it survives the container's lifetime.
echo "🧵 Starting queue worker (QUEUE_CONNECTION=${QUEUE_CONNECTION:-database})…"
( while true; do php artisan queue:work --sleep=1 --tries=2 --max-time=3600 >>/tmp/queue-worker.log 2>&1 || true; sleep 2; done ) &

echo "🚀 Laravel API on http://localhost:8000"
exec php artisan serve --host=0.0.0.0 --port=8000
