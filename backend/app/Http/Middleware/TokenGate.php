<?php

namespace App\Http\Middleware;

use App\Services\TokenMeter;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Pre-call quota gate. Applied to AI-triggering routes as `token.gate:{action}`
 * (e.g. token.gate:chat). Blocks with 402 + an upsell payload BEFORE the
 * expensive AI call is made; actual usage is recorded after the call by
 * TutorService via TokenMeter::record().
 */
class TokenGate
{
    public function __construct(protected TokenMeter $meter) {}

    public function handle(Request $request, Closure $next, string $action = 'chat'): Response
    {
        $user = $request->user();

        // Only students consume credits; admin/parent actions are not gated.
        if (! $user || $user->role !== 'student') {
            return $next($request);
        }

        $check = $this->meter->check($user, $action);

        if (! $check['allowed']) {
            $daily = $check['reason'] === 'daily_limit';

            return response()->json([
                'error' => 'quota_exceeded',
                'reason' => $check['reason'],
                'message' => $daily
                    ? "You've used today's AI learning credits. Come back tomorrow — or upgrade for more."
                    : "You've reached this month's AI learning limit. Upgrade your plan to keep going.",
                'usage' => $check['summary'],
                'upgrade' => ['plan' => 'plus'],
            ], 402);
        }

        // Stash the action so downstream code can read it if useful.
        $request->attributes->set('token_action', $action);

        return $next($request);
    }
}
