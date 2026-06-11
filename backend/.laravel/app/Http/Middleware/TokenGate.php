<?php

namespace App\Http\Middleware;

use App\Services\TokenMeter;
use Closure;
use Illuminate\Http\Request;

/**
 * Pre-call credit gate (token spec §3.1). Attach to every AI-triggering route:
 *   Route::post(...)->middleware('tokens:chat')
 * Blocks with 402 quota_exceeded + an upsell payload when the plan is spent.
 */
class TokenGate
{
    public function __construct(protected TokenMeter $meter) {}

    public function handle(Request $request, Closure $next, string $action = 'chat')
    {
        $blocked = $this->meter->gate($request->user(), $action);

        if ($blocked !== null) {
            return response()->json($blocked, 402);
        }

        return $next($request);
    }
}
