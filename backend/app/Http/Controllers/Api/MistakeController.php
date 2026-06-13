<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Mistake;
use Illuminate\Http\Request;

/**
 * Mistake Notebook: every wrong answer, collected per topic for review and
 * re-teaching. Auto-populated by the assessment grader.
 */
class MistakeController extends Controller
{
    /** GET /tutor/mistakes?topic_name=&topic_id=&include_resolved= */
    public function index(Request $request)
    {
        $q = $request->user()->mistakes();
        if ($request->filled('topic_id')) {
            $q->where('topic_id', $request->integer('topic_id'));
        } elseif ($request->filled('topic_name')) {
            $q->where('topic_name', (string) $request->query('topic_name'));
        }
        if (! $request->boolean('include_resolved')) {
            $q->where('resolved', false);
        }

        return response()->json(['mistakes' => $q->latest()->get()]);
    }

    /** PATCH /tutor/mistakes/{mistake}/resolve — toggle resolved. */
    public function resolve(Request $request, Mistake $mistake)
    {
        abort_unless($mistake->user_id === $request->user()->id, 403, 'Not your mistake.');
        $mistake->update(['resolved' => ! $mistake->resolved]);
        return response()->json(['mistake' => $mistake]);
    }
}
