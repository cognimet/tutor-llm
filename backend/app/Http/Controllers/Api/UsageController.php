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

    /**
     * GET /api/usage/detail — meter + where the credits went.
     * Powers the "Your usage" panel: daily/monthly consumption against the
     * plan, plus a last-30-days breakdown by action (credits only, no ₹).
     */
    public function detail(Request $request)
    {
        $user = $request->user();

        $byAction = TokenLedger::where('user_id', $user->id)
            ->where('created_at', '>=', now()->subDays(30))
            ->selectRaw('action_type, SUM(credits_charged) as credits, COUNT(*) as calls')
            ->groupBy('action_type')->orderByDesc('credits')->get()
            ->map(fn ($r) => [
                'action' => $r->action_type,
                'label' => self::ACTION_LABELS[$r->action_type] ?? $r->action_type,
                'credits' => (int) round($r->credits),
                'calls' => (int) $r->calls,
            ]);

        return response()->json([
            'summary' => $this->meter->summary($user),
            'by_action' => $byAction,
            'period_days' => 30,
        ]);
    }

    /** Friendly names for the credit-bearing actions. */
    private const ACTION_LABELS = [
        'chat' => 'Tutor chat',
        'assess_gen' => 'Quizzes',
        'grade' => 'Grading',
        'gap' => 'Gap analysis',
        'plan' => 'Study plans',
        'notes' => 'Notes & vision',
        'snap' => 'Snap-a-doubt',
    ];

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
