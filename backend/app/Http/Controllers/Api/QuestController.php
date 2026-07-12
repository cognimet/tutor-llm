<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EvidenceEvent;
use App\Models\GameInstance;
use App\Models\Topic;
use App\Services\GamificationService;
use App\Services\Quest\AbilityService;
use App\Services\Quest\GameGeneratorService;
use App\Services\Quest\GameGrader;
use App\Services\Quest\KnowledgeTracingService;
use App\Services\Quest\PathEngineService;
use App\Services\Quest\SkillGraphService;
use App\Services\TokenMeter;
use App\Services\TopicProgressService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * The quest engine's HTTP surface — the core loop of the curriculum-to-games
 * blueprint, closed:
 *
 *   map/next  →  generate a game  →  play  →  evidence  →  BKT + IRT  →  map/next
 *
 * Correctness is decided here, never in the browser: `forPlay()` strips every
 * answer before a game is sent, and {@see GameGrader} re-derives it on the way back.
 */
class QuestController extends Controller
{
    /** A game must be passed, not merely opened, before it pays out. */
    private const REWARD_PASS_PCT = 70;

    public function __construct(
        protected SkillGraphService $graph,
        protected KnowledgeTracingService $bkt,
        protected AbilityService $ability,
        protected PathEngineService $path,
        protected GameGeneratorService $generator,
        protected GameGrader $grader,
        protected TopicProgressService $topicProgress,
        protected GamificationService $gamification,
        protected TokenMeter $meter,
    ) {}

    /** The student's subjects, each with mastery coverage and current ability. */
    public function subjects(Request $request)
    {
        $user = $request->user();

        $subjects = $this->graph->subjectsForLevel($user->level_id)->map(function ($subject) use ($user) {
            $topicIds = $this->graph->skillIds($subject->id);
            $mastered = $topicIds ? count($this->bkt->masteredSet($user, $topicIds)) : 0;

            return [
                'id'             => $subject->id,
                'name'           => $subject->name,
                'emoji'          => $subject->emoji,
                'tint'           => $subject->tint,
                'topics'         => count($topicIds),
                'mastered'       => $mastered,
                'percent'        => $topicIds ? (int) round($mastered / count($topicIds) * 100) : 0,
                'theta'          => round($this->ability->theta($user, $subject->id), 3),
                'next_difficulty'=> $this->ability->recommendDifficulty($user, $subject->id),
            ];
        });

        return response()->json(['subjects' => $subjects->values()]);
    }

    /** The quest map: locked / available / in-progress / mastered nodes for a subject. */
    public function map(Request $request)
    {
        $data = $request->validate(['subject_id' => ['required', 'integer', 'exists:subjects,id']]);
        $user = $request->user();

        $this->authorizeSubject($user, (int) $data['subject_id']);

        return response()->json([
            'nodes' => $this->path->questMap($user, (int) $data['subject_id']),
            'next'  => $this->path->next($user, (int) $data['subject_id']),
            'gaps'  => array_slice($this->bkt->gaps($user, (int) $data['subject_id']), 0, 5),
        ]);
    }

    /** Just the next recommendation (cheap poll for the home screen). */
    public function next(Request $request)
    {
        $data = $request->validate(['subject_id' => ['required', 'integer', 'exists:subjects,id']]);
        $user = $request->user();

        $this->authorizeSubject($user, (int) $data['subject_id']);

        return response()->json(['next' => $this->path->next($user, (int) $data['subject_id'])]);
    }

    /** Days without evidence before a mastered topic is due for review. */
    private const REVIEW_AFTER_DAYS = 7;

    /**
     * Spaced repetition: mastered topics the student hasn't touched in a week.
     *
     * Playing a review game writes fresh evidence, which resets that topic's
     * clock — the queue is self-maintaining, no review log needed. Mastery is
     * never decayed in storage (that would re-lock downstream topics); staleness
     * is computed from the evidence stream instead.
     */
    public function review(Request $request)
    {
        $user = $request->user();
        $due  = [];

        foreach ($this->graph->subjectsForLevel($user->level_id) as $subject) {
            $topicIds = $this->graph->skillIds($subject->id);
            if (! $topicIds) {
                continue;
            }
            $mastered = $this->bkt->masteredSet($user, $topicIds);
            if (! $mastered) {
                continue;
            }

            $lastSeen = EvidenceEvent::where('user_id', $user->id)
                ->whereIn('topic_id', $mastered)
                ->selectRaw('topic_id, MAX(created_at) AS last_at')
                ->groupBy('topic_id')
                ->pluck('last_at', 'topic_id');

            foreach ($mastered as $topicId) {
                if (! isset($lastSeen[$topicId])) {
                    continue; // mastered without evidence (seeded) — nothing to refresh
                }
                $days = (int) \Carbon\Carbon::parse($lastSeen[$topicId])->diffInDays(now());
                if ($days < self::REVIEW_AFTER_DAYS) {
                    continue;
                }
                $due[] = [
                    'topic_id'     => $topicId,
                    'topic_name'   => $this->graph->topic($subject->id, $topicId)['name'] ?? '',
                    'subject_id'   => $subject->id,
                    'subject_name' => $subject->name,
                    'days_since'   => $days,
                    'difficulty'   => $this->ability->recommendDifficulty($user, $subject->id),
                ];
            }
        }

        usort($due, fn ($a, $b) => $b['days_since'] <=> $a['days_since']);

        return response()->json([
            'due'       => array_slice($due, 0, 3), // "Review 3" — a bite, not a backlog
            'total_due' => count($due),
        ]);
    }

    /**
     * Generate (or reuse) a validated game for a topic.
     *
     * Difficulty defaults to the IRT recommendation, keeping the learner in the
     * ~72% success band rather than at a fixed level.
     */
    public function generate(Request $request)
    {
        $data = $request->validate([
            'topic_id'   => ['required', 'integer', 'exists:topics,id'],
            'difficulty' => ['nullable', 'integer', 'min:1', 'max:5'],
            'fresh'      => ['nullable', 'boolean'],
        ]);
        $user = $request->user();

        $topic     = Topic::with('chapter.subject')->findOrFail($data['topic_id']);
        $subjectId = $topic->chapter?->subject_id;
        if (! $subjectId) {
            return response()->json(['message' => 'This topic is not part of a subject.'], 422);
        }
        $this->authorizeSubject($user, $subjectId);

        // A locked node means an unmastered prerequisite — send them there instead.
        $mastered = $this->bkt->masteredSet($user, $this->graph->skillIds($subjectId));
        if (! $this->graph->isReady($subjectId, $topic->id, $mastered)) {
            return response()->json([
                'message' => 'Finish this topic\'s prerequisites first.',
                'next'    => $this->path->next($user, $subjectId),
            ], 423); // 423 Locked
        }

        $difficulty = $data['difficulty'] ?? $this->ability->recommendDifficulty($user, $subjectId);
        $game = $this->generator->generate($topic, $difficulty, $subjectId, (bool) ($data['fresh'] ?? false), $user->id);

        if (! $game) {
            // Never serve unvalidated content. This is nearly always a transient
            // AI failure (rate limit / truncated response), not a property of the
            // topic — so say "try again", and keep the MCQ quiz as the way out.
            // Nothing was produced, so nothing is charged.
            return response()->json([
                'message' => "The game builder is busy right now. Try again in a moment, or take the quiz instead.",
                'retryable' => true,
            ], 503);
        }

        // Charge a credit for the built game, like a generated quiz. The gate
        // (token.gate:game_gen) already checked the student can afford it; here we
        // record the flat credit weight plus the REAL token cost — which is the
        // LLM usage for authored mechanics, and zero for deterministic maths games
        // and cache hits (still one credit, but no rupee cost).
        try {
            $this->meter->record($user, 'game_gen', $this->generator->lastUsage, [
                'topic_id' => $topic->id,
                'mechanic' => $game->mechanic,
                'source'   => $this->generator->lastSource,
            ]);
        } catch (\Throwable) { /* metering must never block a built game */ }

        return response()->json(['game' => $game->forPlay()]);
    }

    /**
     * Grade one item, append the evidence, and update both learner models.
     *
     * This is the write path of the whole engine. The evidence row is the durable
     * fact; BKT mastery and IRT ability are derived from it and can be recomputed.
     */
    public function answer(Request $request, GameInstance $game)
    {
        $data = $request->validate([
            'item_index' => ['required', 'integer', 'min:0'],
            'answer'     => ['present'],
            'time_ms'    => ['nullable', 'integer', 'min:0', 'max:600000'],
            'hints_used' => ['nullable', 'integer', 'min:0', 'max:10'],
        ]);
        $user = $request->user();

        // Games are shared content, so re-check the subject on every write —
        // otherwise a student could farm evidence on another level's topics.
        if ($game->subject_id) {
            $this->authorizeSubject($user, $game->subject_id);
        }

        $items = $game->items ?? [];
        $index = (int) $data['item_index'];
        if (! isset($items[$index])) {
            return response()->json(['message' => 'No such item in this game.'], 404);
        }

        $correct = $this->grader->isCorrect($items[$index], $data['answer']);

        $event = EvidenceEvent::create([
            'user_id'          => $user->id,
            'topic_id'         => $game->topic_id,
            'topic_name'       => $game->topic_name,
            'subject_id'       => $game->subject_id,
            'game_instance_id' => $game->id,
            'item_index'       => $index,
            'correct'          => $correct,
            'submitted'        => $data['answer'], // wrong picks encode misconceptions
            'time_ms'          => (int) ($data['time_ms'] ?? 0),
            'hints_used'       => (int) ($data['hints_used'] ?? 0),
            'difficulty'       => $game->difficulty,
        ]);

        $pMastered = $this->bkt->observe($user, $event);
        $theta = $game->subject_id
            ? $this->ability->observe($user, $game->subject_id, $game->difficulty, $correct)
            : 0.0;

        $response = [
            'correct'    => $correct,
            'p_mastered' => round($pMastered, 3),
            'mastered'   => $pMastered >= KnowledgeTracingService::MASTERY_THRESHOLD,
            'theta'      => round($theta, 3),
        ];

        // Feedback that teaches, not just "correct"/"wrong": a first miss earns a
        // retry (the reinforcement loop), and only once the item is DONE — solved,
        // or missed twice — do we reveal the answer and its mini-lesson. Revealing
        // on the first miss would make the retry a copy exercise. The attempt count
        // comes from the evidence stream, so a client can't talk its way past it.
        $attempts = EvidenceEvent::where('user_id', $user->id)
            ->where('game_instance_id', $game->id)
            ->where('item_index', $index)
            ->count();

        if ($correct || $attempts >= 2) {
            if ($explain = trim((string) ($items[$index]['explain'] ?? ''))) {
                $response['explain'] = $explain;
            }
            if (! $correct) {
                $response['correct_answer'] = $this->displayAnswer($items[$index]);
            }
        } else {
            $response['can_retry'] = true;
        }

        return response()->json($response);
    }

    /** The keyed answer, shaped for a child to read (not for the grader). */
    protected function displayAnswer(array $item): string
    {
        $answer = (string) ($item['answer'] ?? '');
        $kind   = $item['params']['kind'] ?? '';

        if ($kind === 'sequence') {
            return str_replace(' | ', ' → ', $answer);
        }
        if (in_array($kind, ['word_match', 'sort_bucket'], true)) {
            $map = json_decode($answer, true);
            if (is_array($map)) {
                return collect($map)->map(fn ($v, $k) => "{$k} → {$v}")->implode(' · ');
            }
        }
        return $answer;
    }

    /**
     * End of a game: roll the evidence up into topic progress and hand out rewards.
     *
     * The score is recomputed from the evidence stream, so a client can't claim a
     * result it didn't earn, and an abandoned game simply scores low.
     */
    public function finish(Request $request, GameInstance $game)
    {
        $user = $request->user();

        if ($game->subject_id) {
            $this->authorizeSubject($user, $game->subject_id);
        }

        // Score = FIRST attempt per item. Retries exist to reinforce, not to farm:
        // fixing a miss still updates mastery (BKT saw both attempts) but can't
        // buy back the star — so "retry until it sticks" is free of gaming value.
        $events   = EvidenceEvent::where('user_id', $user->id)->where('game_instance_id', $game->id)->orderBy('id')->get();
        $first    = $events->groupBy('item_index')->map(fn ($e) => $e->first());
        $attempts = $first->count();
        $hits     = $first->where('correct', true)->count();
        $pct      = $attempts > 0 ? (int) round($hits / $attempts * 100) : 0;

        // Progress and rewards are best-effort: a failure here must never cost the
        // student the play they just did (the evidence is already durable).
        $progress = null;
        try {
            $progress = $this->topicProgress->present($this->topicProgress->recordGame($user, $game));
        } catch (\Throwable) { /* progress is a cache */ }

        // Reward learning, not grinding (blueprint §5): only a passing game pays,
        // and only the first time — `Cache::add` is atomic, so replaying /finish
        // in a loop can't farm XP.
        $reward = null;
        $firstFinish = Cache::add("quest:rewarded:{$user->id}:{$game->id}", true, now()->addDays(30));
        if ($firstFinish && $pct >= self::REWARD_PASS_PCT) {
            try {
                $reward = $this->gamification->award($user, $pct === 100 ? 'perfect_quiz' : 'answer_correct');
            } catch (\Throwable) { /* rewards are cosmetic */ }
        }

        $next = $game->subject_id ? $this->path->next($user, $game->subject_id) : null;

        // Warm the cache for the recommended next topic while the student reads
        // their results, so the next "Play" opens instantly instead of waiting on
        // the LLM. Runs after the response is sent; entirely best-effort. The
        // student is still charged their normal credit when they actually play.
        if ($next && ! empty($next['topic_id'])) {
            $topicId    = (int) $next['topic_id'];
            $difficulty = max(1, min(5, (int) ($next['recommended_difficulty'] ?? 3)));
            $userId     = $user->id;
            dispatch(function () use ($topicId, $difficulty, $userId) {
                try {
                    if (GameInstance::where('topic_id', $topicId)->where('difficulty', $difficulty)
                        ->where('validated', true)->exists()) {
                        return; // already instant
                    }
                    $topic = Topic::with('chapter.subject')->find($topicId);
                    if ($topic) {
                        app(GameGeneratorService::class)
                            ->generate($topic, $difficulty, $topic->chapter?->subject_id, false, $userId);
                    }
                } catch (\Throwable) { /* warming must never break anything */ }
            })->afterResponse();
        }

        return response()->json([
            'score'          => $hits,
            'total'          => $attempts,
            'percent'        => $pct,
            'p_mastered'     => $game->topic_id ? round($this->bkt->pMastered($user, $game->topic_id), 3) : null,
            'topic_progress' => $progress,
            'reward'         => $reward,
            'next'           => $next,
        ]);
    }

    /** Students may only quest inside their own level's subjects. */
    protected function authorizeSubject($user, int $subjectId): void
    {
        $allowed = $this->graph->subjectsForLevel($user->level_id)->pluck('id')->all();
        abort_unless(in_array($subjectId, $allowed, true), 403, 'That subject is not in your curriculum.');
    }
}
