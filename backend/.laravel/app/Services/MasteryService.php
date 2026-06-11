<?php

namespace App\Services;

use App\Models\ChatSession;
use App\Models\ConceptMastery;
use App\Models\Misconception;
use App\Models\User;

/**
 * Concept-level mastery math (master prompt C1) + live misconception tracking.
 *
 * EWMA per concept: new = (1-alpha)*old + alpha*outcome, alpha ~0.4.
 * A topic is mastered only when EVERY concept passes (score>=0.8, conf>=2) —
 * never an average, averaging hides the one weak spot.
 */
class MasteryService
{
    /** Record an observation for one concept. Outcome in [0,1]. */
    public function observe(User $user, string $topic, string $concept, float $outcome, float $alpha = 0.4): ConceptMastery
    {
        $concept = trim($concept) !== '' ? trim($concept) : 'General';

        $row = ConceptMastery::firstOrCreate(
            ['user_id' => $user->id, 'topic_name' => $topic, 'concept' => $concept],
            ['score' => 0, 'confidence' => 0],
        );

        $row->update([
            'score' => (1 - $alpha) * (float) $row->score + $alpha * max(0, min(1, $outcome)),
            'confidence' => $row->confidence + 1,
            'last_seen_at' => now(),
        ]);

        return $row;
    }

    /**
     * Apply a chat-turn mastery signal (in [-1,1]) to the turn's concept tags.
     * Lighter alpha than assessments — conversation evidence is softer.
     */
    public function observeChatSignal(User $user, string $topic, array $conceptTags, ?float $signal): void
    {
        if ($signal === null || empty($conceptTags)) {
            return;
        }
        $outcome = (max(-1, min(1, $signal)) + 1) / 2;
        foreach (array_slice($conceptTags, 0, 4) as $tag) {
            $this->observe($user, $topic, (string) $tag, $outcome, alpha: 0.2);
        }
    }

    /** Open a misconception (deduped) the moment the tutor spots it. */
    public function detectMisconception(User $user, string $topic, string $description, ?int $sessionId = null): void
    {
        $description = trim($description);
        if ($description === '') {
            return;
        }

        $exists = Misconception::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->where('status', 'open')
            ->where('description', $description)
            ->exists();

        if (! $exists) {
            Misconception::create([
                'user_id' => $user->id,
                'chat_session_id' => $sessionId,
                'topic_name' => $topic,
                'description' => $description,
                'status' => 'open',
                'detected_at' => now(),
            ]);
        }
    }

    /** Mark the closest open misconception resolved (open -> fixed in-session). */
    public function resolveMisconception(User $user, string $topic, string $description): void
    {
        $open = Misconception::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->where('status', 'open')
            ->get();

        if ($open->isEmpty()) {
            return;
        }

        // Exact match first, else best token overlap.
        $target = $open->firstWhere('description', $description);
        if (! $target) {
            $words = collect(preg_split('/\W+/u', mb_strtolower($description)))->filter();
            $target = $open->sortByDesc(function ($m) use ($words) {
                $theirs = collect(preg_split('/\W+/u', mb_strtolower($m->description)))->filter();
                return $words->intersect($theirs)->count();
            })->first();
        }

        $target?->update(['status' => 'resolved', 'resolved_at' => now()]);
    }

    /**
     * The "shows its mind" payload for the chat page's right panel (spec D6):
     * live mastery, misconceptions, memory, next step.
     */
    public function mind(User $user, string $topic, ?ChatSession $session = null): array
    {
        $rows = ConceptMastery::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->orderBy('concept')
            ->get();

        $composite = $rows->isEmpty() ? 0 : (int) round($rows->avg('score') * 100);
        $allPass = $rows->isNotEmpty() && $rows->every(fn ($r) => $r->passes());

        $misconceptions = Misconception::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->orderByDesc('id')
            ->take(8)
            ->get(['id', 'description', 'status', 'detected_at', 'resolved_at']);

        return [
            'topic' => $topic,
            'composite_mastery' => $composite,
            'topic_mastered' => $allPass,
            'concepts' => $rows->map(fn ($r) => [
                'concept' => $r->concept,
                'score' => (int) round($r->score * 100),
                'confidence' => $r->confidence,
                'passes' => $r->passes(),
            ])->values(),
            'misconceptions' => $misconceptions,
            'memory' => array_filter([
                'curriculum' => $user->curriculum_path,
                'language' => $user->language,
            ]),
            'next_step' => $session?->next_step,
            'state' => $session?->state,
            'attempt_no' => $session?->attempt_no,
            'mode' => $session?->mode,
        ];
    }
}
