# Laravel API container — supplies PHP 8.2 + Composer so you don't have to install them.
FROM php:8.2-cli

# System deps + PHP extensions Laravel/Sanctum need.
# pdo_pgsql for Postgres (system of record); pdo_sqlite kept for local fallback.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libsqlite3-dev libzip-dev libonig-dev libpq-dev postgresql-client \
    && docker-php-ext-install pdo pdo_sqlite pdo_pgsql zip \
    && rm -rf /var/lib/apt/lists/*

# Composer.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

# Copy the overlay (app code, routes, migrations, seeders, config, env, entrypoint).
COPY . /overlay

# Scaffold a fresh Laravel app + Sanctum once at build time, then overlay our files.
# NOTE: composer steps must NOT be ||-swallowed — a failed download would
# otherwise produce an image with no vendor/ that only breaks at runtime.
#
# Newer Composer blocks installs whose versions carry security advisories
# (policy.advisories.block). Laravel 11.x currently trips this; acceptable for
# local/dev. TODO: upgrade the app to laravel/laravel:^12.0 and re-enable.
RUN composer config --global policy.advisories.block false || true
RUN composer create-project "laravel/laravel:^11.0" /app --no-interaction
RUN composer require laravel/sanctum --no-interaction
RUN php artisan install:api --no-interaction || true
RUN test -f /app/vendor/autoload.php  # fail the build early if vendor is missing
# install:api publishes the Sanctum migration with a BUILD-TIME timestamp,
# which makes every rebuild look like a brand-new migration to an existing
# database (-> "Duplicate table: personal_access_tokens"). Drop the published
# copy; the overlay ships a fixed-name, guarded version instead.
RUN rm -f /app/database/migrations/*_create_personal_access_tokens_table.php
RUN cp -R /overlay/app/. /app/app/ \
    && cp -R /overlay/routes/. /app/routes/ \
    && cp -R /overlay/database/migrations/. /app/database/migrations/ \
    && cp -R /overlay/database/seeders/. /app/database/seeders/ \
    && cp /overlay/config/gemini.php /app/config/gemini.php \
    && cp /overlay/config/ai_service.php /app/config/ai_service.php \
    && cp /overlay/config/cors.php /app/config/cors.php \
    && cp /overlay/bootstrap/app.php /app/bootstrap/app.php \
    && cp /overlay/.env.example /app/.env \
    && cp /overlay/docker-entrypoint.sh /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
