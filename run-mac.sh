#!/usr/bin/env bash
# Everything AI Tutor — one-command local run for macOS.
# Installs PHP, Composer, Node (via Homebrew if missing), sets up the Laravel
# backend on SQLite, installs the frontend, and starts BOTH servers.
#
# Run it with:
#   bash "$HOME/Documents/AI Tutor/AI Tutor MVP/run-mac.sh"

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
say() { printf "\n\033[1;35m==> %s\033[0m\n" "$1"; }

# ---------------------------------------------------------------- prerequisites
if ! command -v brew >/dev/null 2>&1; then
  cat <<'MSG'
✗ Homebrew is not installed (needed to install PHP/Node).
  Install it once by pasting this into Terminal, then re-run this script:

  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
MSG
  exit 1
fi

say "Checking tools (PHP, Composer, Node)…"
command -v php      >/dev/null 2>&1 || { say "Installing PHP…";      brew install php; }
command -v composer >/dev/null 2>&1 || { say "Installing Composer…"; brew install composer; }
command -v node     >/dev/null 2>&1 || { say "Installing Node…";     brew install node; }
command -v python3  >/dev/null 2>&1 || { say "Installing Python…";   brew install python; }

echo "  php:      $(php -v | head -1)"
echo "  composer: $(composer -V)"
echo "  node:     $(node -v)"

# ---------------------------------------------------------------- backend setup
cd "$ROOT/backend"
if [ ! -d ".laravel" ]; then
  say "First-time backend setup (scaffolds Laravel, migrates + seeds)…"
  bash setup.sh
else
  say "Backend already set up — applying any new migrations…"
  ( cd .laravel && php artisan migrate --force >/dev/null 2>&1 || true )
fi

# ---------------------------------------------------------------- AI service deps
cd "$ROOT/ai-service"
if [ ! -d ".venv" ]; then
  say "Setting up the Python AI service…"
  python3 -m venv .venv
  ./.venv/bin/pip install -q -r requirements.txt
fi

# ---------------------------------------------------------------- frontend deps
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  say "Installing frontend dependencies…"
  npm install
fi

# ---------------------------------------------------------------- run both
say "Starting servers…"
cleanup() { echo; say "Shutting down…"; kill "$BACK" "$FRONT" "$AI" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

( cd "$ROOT/ai-service" && GEMINI_API_KEY="${GEMINI_API_KEY:-}" GEMINI_MOCK="${GEMINI_MOCK:-}" \
  ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 ) & AI=$!
( cd "$ROOT/backend/.laravel" && AI_SERVICE_URL="${AI_SERVICE_URL:-http://localhost:8001}" \
  php artisan serve --port=8000 ) & BACK=$!
( cd "$ROOT/frontend" && npm run dev ) & FRONT=$!

sleep 5
say "Opening http://localhost:5173"
open "http://localhost:5173" 2>/dev/null || true

cat <<'MSG'

✅ Running!
   Frontend : http://localhost:5173
   API      : http://localhost:8000
   AI svc   : http://localhost:8001

   Demo logins (password: password)
     admin@tuto.ai · student@tuto.ai · parent@tuto.ai

   Press Ctrl+C to stop both servers.
MSG

wait
