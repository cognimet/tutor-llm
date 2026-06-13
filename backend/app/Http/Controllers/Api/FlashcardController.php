<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Flashcard;
use App\Services\EventTracker;
use App\Services\SrsService;
use Illuminate\Http\Request;

/**
 * Spaced-repetition flashcards (SM-2), sourced from notes + mistakes.
 */
class FlashcardController extends Controller
{
    public function __construct(
        protected SrsService $srs,
        protected EventTracker $events,
    ) {}

    /** GET /tutor/flashcards?topic_name=&topic_id= — all cards for a topic. */
    public function index(Request $request)
    {
        $cards = $this->scope($request)->orderBy('due_at')->get();
        return response()->json(['flashcards' => $cards, 'due_count' => $this->dueQuery($request)->count()]);
    }

    /** GET /tutor/flashcards/due — cards due for review now. */
    public function due(Request $request)
    {
        $cards = $this->dueQuery($request)->orderBy('due_at')->take(40)->get();
        return response()->json(['flashcards' => $cards]);
    }

    /** POST /tutor/flashcards/{card}/review { grade: 0..5 } */
    public function review(Request $request, Flashcard $card)
    {
        abort_unless($card->user_id === $request->user()->id, 403, 'Not your card.');
        $grade = (int) $request->validate(['grade' => ['required', 'integer', 'min:0', 'max:5']])['grade'];

        $updated = $this->srs->review($card, $grade);

        $this->events->track(
            $request->user(), EventTracker::FLASHCARD,
            "Reviewed flashcard (recall grade {$grade}/5): " . mb_substr($card->front, 0, 200),
            $card->topic_name, $card->topic_id, [],
            ['grade' => $grade, 'source' => $card->source_type],
        );

        return response()->json(['flashcard' => $updated]);
    }

    /* ----------------------------------------------------------------- */

    protected function scope(Request $request)
    {
        $q = $request->user()->flashcards();
        if ($request->filled('topic_id')) {
            return $q->where('topic_id', $request->integer('topic_id'));
        }
        if ($request->filled('topic_name')) {
            return $q->where('topic_name', (string) $request->query('topic_name'));
        }
        return $q;
    }

    protected function dueQuery(Request $request)
    {
        return $this->scope($request)->where(fn ($q) => $q->whereNull('due_at')->orWhere('due_at', '<=', now()));
    }
}
