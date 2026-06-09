<?php

// PHP 8.5 emits E_DEPRECATED notices for some constants still referenced by
// Laravel 11's default config (e.g. PDO::MYSQL_ATTR_SSL_CA in config/database.php).
// With display_errors on (dev default) those notices get printed into HTTP
// responses, corrupting JSON API output. Suppress deprecations app-wide; this
// runs before config is loaded during the request bootstrap.
error_reporting(error_reporting() & ~E_DEPRECATED);

use App\Http\Middleware\EnsureRole;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        // Register the role alias used by route definitions.
        $middleware->alias([
            'role' => EnsureRole::class,
        ]);

        // NOTE: This SPA authenticates with Bearer tokens (see frontend
        // api/client.js), not session cookies. Enabling Sanctum's stateful
        // API middleware would apply CSRF protection to requests coming from
        // the frontend domain (localhost), causing 419 "Page Expired" errors
        // on login. Token auth via the `auth:sanctum` guard needs no CSRF, so
        // statefulApi() is intentionally left off.
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
