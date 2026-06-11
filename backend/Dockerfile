# Laravel API container — supplies PHP 8.2 + Composer so you don't have to install them.
FROM php:8.2-cli

# System deps + PHP extensions Laravel/Sanctum need.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libsqlite3-dev libzip-dev libonig-dev \
    && docker-php-ext-install pdo pdo_sqlite zip \
    && rm -rf /var/lib/apt/lists/*

# Composer.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Composer 2.9+ refuses to install packages with open security advisories.
# laravel/framework ^11.31 (the Laravel 11 skeleton) currently has advisories
# that are only fixed in Laravel 12, so the policy must be relaxed for this
# local dev image — otherwise create-project fails with "requirements could
# not be resolved" (PKSA-... advisories).
RUN composer config --global policy.advisories.block false

WORKDIR /app

# Scaffold a fresh Laravel app + Sanctum once at build time (cached — runs
# again only if this Dockerfile changes, not on every source edit).
# NOTE: the `|| true` is scoped to install:api ONLY. If it applied to the whole
# chain (as it once did), a composer network failure would silently produce an
# image with no vendor/ directory — and Docker would cache that broken layer.
# The final `test` guarantees the layer fails loudly if vendor/ is missing.
RUN composer create-project "laravel/laravel:^11.0" /app --no-interaction \
    && composer require laravel/sanctum --no-interaction \
    && (php artisan install:api --no-interaction || true) \
    && test -f /app/vendor/autoload.php

# Copy the overlay (app code, routes, migrations, seeders, config, env, entrypoint).
COPY . /overlay
RUN cp -R /overlay/app/. /app/app/ \
    && cp -R /overlay/routes/. /app/routes/ \
    && cp -R /overlay/database/migrations/. /app/database/migrations/ \
    && cp -R /overlay/database/seeders/. /app/database/seeders/ \
    && cp /overlay/config/*.php /app/config/ \
    && cp /overlay/bootstrap/app.php /app/bootstrap/app.php \
    && cp /overlay/.env.example /app/.env \
    && cp /overlay/docker-entrypoint.sh /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
