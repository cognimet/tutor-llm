<?php

namespace App\Services;

use App\Models\ChatSession;
use App\Models\ConceptMastery;
use App\Models\Misconception;
use App\Models\StudentMemory;
use App\Models\User;

/**
 * The tutor's "mind": cross-session memory, concept-level EWMA mastery, and
 * live misconception tracking. Fed by the structured signals TutorService
 * extracts after each chat turn; read by the chat page's right panel and
 * injected back into every tutor prompt so the AI genuinely "knows" the
 * student (Chat Page Spec §6, master prompt C1).
 */
class MindService
{
    /* ----------------------------- memory ----------------------------- */

    /** Persist durable facts about the student (learning style, struggles…). */
    public function remember(User $user, array $facts): void
    {
        foreach ($facts as $key => $value) {
            $key = trim((string) $key);
            $value = trim((string) $value);
            if ($key === '' || $value === '' || mb_strlen($key) > 60 || mb_strlen($value) > 400) {
                continue;
            }
            StudentMemory::updateOrCreate(
                ['user_id' => $user->id, 'key' => $key],
                ['value' => $value],
            );
        }
    }

    /** @return array<string,string> key => value */
    public function memory(User $user): array
    {
        return StudentMemory::where('user_id', $user->id)
            ->orderBy('key')
            ->pluck('value', 'key')
            ->all();
    }

    /* ----------------------------- mastery ---------------------------- */

    /** Record one observation for a concept. Outcome in [0,1]; EWMA alpha 0.4. */
    public function observe(User $user, string $topic, string $concept, float $outcome, float $alpha = 0.4): void
    {
        $concept = trim($concept);
        if ($concept === '' || mb_strlen($concept) > 160) {
            return;
        }

        $row = ConceptMastery::firstOrCreate(
            ['user_id' => $user->id, 'topic_name' => $topic, 'concept' => $concept],
            ['score' => 0, 'confidence' => 0],
        );

        $row->update([
            'score' => (1 - $alpha) * (float) $row->score + $alpha * max(0, min(1, $outcome)),
            'confidence' => $row->confidence + 1,
            'last_seen_at' => now(),
        ]);
    }

    /**
     * Apply a chat-turn mastery signal (-1..1) to the turn's concept tags.
     * Conversation evidence is softer than assessments -> lighter alpha.
     */
    public function observeChatSignal(User $user, string $topic, array $conceptTags, $signal): void
    {
        if ($signal === null || $signal === '' || empty($conceptTags)) {
            return;
        }
        $outcome = (max(-1, min(1, (float) $signal)) + 1) / 2;
        foreach (array_slice($conceptTags, 0, 4) as $tag) {
            $this->observe($user, $topic, (string) $tag, $outcome, alpha: 0.2);
        }
    }

    /* -------------------------- misconceptions ------------------------ */

    public function detectMisconception(User $user, string $topic, string $description, ?int $sessionId = null): void
    {
        $description = mb_substr(trim($description), 0, 300);
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

    /** Mark the closest open misconception as resolved (open -> fixed live). */
    public function resolveMisconception(User $user, string $topic, string $description): void
    {
        $open = Misconception::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->where('status', 'open')
            ->get();

        if ($open->isEmpty()) {
            return;
        }

        $target = $open->firstWhere('description', $description);
        if (! $target) {
            // Best token overlap when the model paraphrases.
            $words = collect(preg_split('/\W+/u', mb_strtolower($description)))->filter();
            $target = $open->sortByDesc(function ($m) use ($words) {
                $theirs = collect(preg_split('/\W+/u', mb_strtolower($m->description)))->filter();
                return $words->intersect($theirs)->count();
            })->first();
        }

        $target?->update(['status' => 'resolved', 'resolved_at' => now()]);
    }

    /* ------------------------------ panel ------------------------------ */

    /** The "shows its mind" payload for the chat page's right panel. */
    public function mind(User $user, string $topic, ?ChatSession $session = null): array
    {
        $rows = ConceptMastery::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->orderByDesc('last_seen_at')
            ->take(10)
            ->get();

        $composite = $rows->isEmpty() ? 0 : (int) round($rows->avg('score') * 100);

        $misconceptions = Misconception::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->orderByDesc('id')
            ->take(8)
            ->get(['id', 'description', 'status', 'detected_at', 'resolved_at']);

        $memory = $this->memory($user);
        $nextStep = $memory["next_step::{$topic}"] ?? null;
        unset($memory["next_step::{$topic}"]);
        // Hide other per-topic next steps from the generic memory list.
        $memory = array_filter($memory, fn ($v, $k) => ! str_starts_with($k, 'next_step::'), ARRAY_FILTER_USE_BOTH);

        return [
            'topic' => $topic,
            'composite_mastery' => $composite,
            'topic_mastered' => $rows->isNotEmpty() && $rows->every(fn ($r) => $r->passes()),
            'concepts' => $rows->map(fn ($r) => [
                'concept' => $r->concept,
                'score' => (int) round($r->score * 100),
                'confidence' => $r->confidence,
                'passes' => $r->passes(),
            ])->values(),
            'misconceptions' => $misconceptions,
            'memory' => $memory,
            'next_step' => $nextStep,
        ];
    }

    /** Compact context block injected into tutor prompts (the AI's recall). */
    public function promptContext(User $user, string $topic): string
    {
        $bits = [];

        $memory = collect($this->memory($user))
            ->reject(fn ($v, $k) => str_starts_with($k, 'next_step::'))
            ->take(8);
        if ($memory->isNotEmpty()) {
            $bits[] = 'What you remember about this student: '
                . $memory->map(fn ($v, $k) => str_replace('_', ' ', $k) . ': ' . $v)->implode('; ') . '.';
        }

        $mastery = ConceptMastery::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->orderBy('score')
            ->take(8)
            ->get();
        if ($mastery->isNotEmpty()) {
            $bits[] = 'Concept mastery on this topic so far: '
                . $mastery->map(fn ($m) => "{$m->concept} " . round($m->score * 100) . '%')->implode(', ')
                . '. Adapt difficulty toward the weakest concepts.';
        }

        $open = Misconception::where('user_id', $user->id)
            ->where('topic_name', $topic)
            ->where('status', 'open')
            ->latest('id')->take(5)->pluck('description');
        if ($open->isNotEmpty()) {
            $bits[] = 'Open misconceptions to watch for and FIX: ' . $open->implode('; ') . '.';
        }

        return $bits ? "\n" . implode("\n", $bits) : '';
    }

    /** Store the tutor's recommended next step for a topic. */
    public function setNextStep(User $user, string $topic, ?string $nextStep): void
    {
        $nextStep = trim((string) $nextStep);
        if ($nextStep === '') {
            return;
        }
        StudentMemory::updateOrCreate(
            ['user_id' => $user->id, 'key' => "next_step::{$topic}"],
            ['value' => mb_substr($nextStep, 0, 400)],
        );
    }
}
