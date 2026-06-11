<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TokenLedger;
use App\Models\User;
use App\Services\TokenMeter;
use Illuminate\Http\Request;

/**
 * Usage meters for students and parents.
 * Students/parents see CREDITS only — never raw tokens or ₹ (admin-only).
 */
class UsageController extends Controller
{
    public function __construct(protected TokenMeter $meter) {}

    /** GET /api/usage — the logged-in student's credit meter. */
    public function me(Request $request)
    {
        return response()->json($this->meter->summary($request->user()));
    }

    /** GET /api/parent/children/{child}/usage — child's usage for the parent. */
    public function child(Request $request, User $child)
    {
        abort_unless(
            $request->user()->children()->whereKey($child->id)->exists(),
            403, 'Not your linked child.'
        );

        $summary = $this->meter->summary($child);

        // Last 7 days of activity by action type (credits, not tokens).
        $byAction = TokenLedger::where('user_id', $child->id)
            ->where('created_at', '>=', now()->subDays(7))
            ->selectRaw('action_type, SUM(credits_charged) as credits, COUNT(*) as calls')
            ->groupBy('action_type')
            ->get();

        return response()->json([
            'summary' => $summary,
            'last_7_days' => $byAction,
        ]);
    }
}
