#!/usr/bin/env bash
# One-shot backend setup. Run from inside the "backend" folder.
# It scaffolds a fresh Laravel 11 app in a temp dir, then overlays the
# application files shipped in this repo and boots everything on SQLite.
set -e

OVERLAY="$(pwd)"
APP_DIR="$OVERLAY/.laravel"

echo "==> Creating Laravel 11 skeleton (requires PHP 8.2+ and Composer)…"
COMPOSER_NO_AUDIT=1 composer create-project "laravel/laravel:^11.0" "$APP_DIR" --no-interaction

echo "==> Installing Sanctum + API scaffolding…"
cd "$APP_DIR"
COMPOSER_NO_AUDIT=1 composer require laravel/sanctum --no-interaction
php artisan install:api --no-interaction || true

echo "==> Overlaying application files…"
cp -R "$OVERLAY/app/." "$APP_DIR/app/"
cp -R "$OVERLAY/routes/." "$APP_DIR/routes/"
cp -R "$OVERLAY/database/migrations/." "$APP_DIR/database/migrations/"
cp -R "$OVERLAY/database/seeders/." "$APP_DIR/database/seeders/"
cp "$OVERLAY"/config/*.php "$APP_DIR/config/"
cp "$OVERLAY/bootstrap/app.php" "$APP_DIR/bootstrap/app.php"
cp "$OVERLAY/.env" "$APP_DIR/.env"

echo "==> Database (SQLite) + key + migrate + seed…"
touch "$APP_DIR/database/database.sqlite"
php artisan key:generate
php artisan migrate:fresh --seed

echo ""
echo "✅ Backend ready. Start it with:"
echo "   cd .laravel && php artisan serve"
echo ""
echo "Demo logins (password: password):"
echo "   admin@tuto.ai · student@tuto.ai · parent@tuto.ai"
