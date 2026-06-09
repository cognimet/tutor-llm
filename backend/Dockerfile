# Laravel API container — supplies PHP 8.2 + Composer so you don't have to install them.
FROM php:8.2-cli

# System deps + PHP extensions Laravel/Sanctum need.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libsqlite3-dev libzip-dev libonig-dev \
    && docker-php-ext-install pdo pdo_sqlite zip \
    && rm -rf /var/lib/apt/lists/*

# Composer.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

# Copy the overlay (app code, routes, migrations, seeders, config, env, entrypoint).
COPY . /overlay

# Scaffold a fresh Laravel app + Sanctum once at build time, then overlay our files.
RUN composer create-project "laravel/laravel:^11.0" /app --no-interaction \
    && composer require laravel/sanctum --no-interaction \
    && php artisan install:api --no-interaction || true
RUN cp -R /overlay/app/. /app/app/ \
    && cp -R /overlay/routes/. /app/routes/ \
    && cp -R /overlay/database/migrations/. /app/database/migrations/ \
    && cp -R /overlay/database/seeders/. /app/database/seeders/ \
    && cp /overlay/config/gemini.php /app/config/gemini.php \
    && cp /overlay/config/cors.php /app/config/cors.php \
    && cp /overlay/bootstrap/app.php /app/bootstrap/app.php \
    && cp /overlay/.env.example /app/.env \
    && cp /overlay/docker-entrypoint.sh /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
