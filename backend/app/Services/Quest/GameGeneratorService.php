<?php

namespace App\Services\Quest;

use App\Models\GameInstance;
use App\Models\Topic;
use App\Services\AiClient;
use Illuminate\Support\Facades\Log;

/**
 * Engine 2 — skill → playable game instance.
 *
 * Port of LearnQuest's `engines/game_generator.py`, adapted to an arbitrary
 * curriculum. The blueprint's rule holds unchanged: the LLM never writes game
 * code. Mechanics are hand-built templates; something fills their content
 * contract; {@see GameValidator} independently re-solves every item before it
 * can be stored.
 *
 * Two authoring paths:
 *
 *  - **Deterministic** (number_line, build_number, compare, pizza) — authored in
 *    PHP from a seeded RNG. Free, instant, infinitely varied, and correct by
 *    construction. These never touch the LLM, so a class doing times tables costs
 *    nothing to serve.
 *  - **LLM-authored** (word_builder, word_match, rhyme_pick, sort_bucket,
 *    sentence_builder) — Gemini fills the content contract via the AI service,
 *    which validates in Python; we then re-validate here and only persist what
 *    survives. Because generation is expensive, these instances are cached per
 *    (topic, difficulty) and replayed with fresh item ordering.
 */
class GameGeneratorService
{
    /** Items per game. */
    private const ITEMS_PER_GAME = 6;

    /** Distinct cached instances to accumulate per (topic, difficulty) before reusing. */
    private const CACHE_VARIANTS = 3;

    /** Below this many valid items an LLM payload is not worth serving. */
    private const MIN_VALID_ITEMS = 3;

    public function __construct(
        protected MechanicPicker $picker,
        protected GameValidator $validator,
        protected AiClient $ai,
    ) {}

    /**
     * Real LLM token usage from the most recent {@see generate()} call, or [] when
     * it did no AI work (a deterministic mechanic or a cache hit). The caller uses
     * this to meter credits — see {@see \App\Http\Controllers\Api\QuestController::generate}.
     */
    public array $lastUsage = [];

    /** How the most recent game was produced: 'deterministic' | 'cache' | 'llm' | ''. */
    public string $lastSource = '';

    /**
     * Produce a playable, validated game for a topic at a difficulty.
     *
     * Content is drawn from the topic's actual curriculum: EVERY mechanic (math
     * included) is authored by the AI service grounded in the topic's retrieved
     * syllabus + the student's own notes, then re-solved here. The math mechanics
     * used to be context-free random drills; that fallback now only runs when the
     * AI is unavailable, so a game is never broken — but a working AI always wins.
     *
     * @param  ?int $userId  the student, so authoring can ground in their notes.
     * @return GameInstance|null  null when no correct game could be authored — the
     *                            caller should degrade to the normal MCQ quiz
     *                            rather than show a child unvalidated content.
     */
    public function generate(Topic $topic, int $difficulty, ?int $subjectId = null, bool $fresh = false, ?int $userId = null): ?GameInstance
    {
        $this->lastUsage = [];
        $this->lastSource = '';

        $difficulty  = max(1, min(5, $difficulty));
        $chapterName = $topic->chapter?->name;
        $subjectName = $topic->chapter?->subject?->name;
        $subjectId ??= $topic->chapter?->subject_id;

        $mechanic = $this->picker->pick($topic->mechanic, $topic->name, $chapterName, $subjectName);

        // Reuse a cached, curriculum-grounded variant once we hold enough (no new
        // AI cost). Applies to every mechanic now — math is cached too.
        if (! $fresh) {
            $cached = GameInstance::where('topic_id', $topic->id)
                ->where('difficulty', $difficulty)
                ->where('mechanic', $mechanic)
                ->where('validated', true)
                ->get();

            if ($cached->count() >= self::CACHE_VARIANTS) {
                $this->lastSource = 'cache';
                return $cached->random();
            }
        }

        // Author from the course: the AI service grounds every mechanic in the
        // topic's curriculum (and the student's notes) before filling the template.
        $items = $this->authorWithLlm($mechanic, $topic->name, $chapterName, $subjectName, $difficulty, $subjectId, $userId);
        // The AI call happened regardless of how many items survived — capture its
        // real token usage so the caller charges for what it actually cost.
        $this->lastUsage = $this->ai->lastUsage;

        $items = $this->validator->keepValid($items);
        if (count($items) >= self::MIN_VALID_ITEMS) {
            $this->lastSource = 'llm';
            return $this->store($topic, $subjectId, $mechanic, $difficulty, $items);
        }

        Log::warning('Grounded game authoring produced too few valid items', [
            'topic' => $topic->name, 'mechanic' => $mechanic, 'valid' => count($items),
        ]);

        // Fallbacks, in order of preference:
        // 1) a cached variant for this topic (still curriculum-grounded);
        if ($cachedAny = GameInstance::where('topic_id', $topic->id)->where('validated', true)->inRandomOrder()->first()) {
            $this->lastSource = 'cache';
            return $cachedAny;
        }
        // 2) for a math mechanic, the deterministic author — generic, but correct
        //    and never broken (used offline / in mock / when the AI is down).
        if ($this->picker->isDeterministic($mechanic)) {
            $this->lastSource = 'deterministic';
            $this->lastUsage = []; // no AI work in the fallback
            return $this->store($topic, $subjectId, $mechanic, $difficulty,
                $this->authorDeterministic($mechanic, $topic->name, $difficulty, random_int(1, PHP_INT_MAX)));
        }

        return null; // a conceptual game we couldn't ground — caller offers the quiz
    }

    /* -------------------------------------------------------------------- */

    /** Persist, re-validating one last time so `validated` can never lie. */
    protected function store(Topic $topic, ?int $subjectId, string $mechanic, int $difficulty, array $items): ?GameInstance
    {
        [$ok, $errors] = $this->validator->validate($items);
        if (! $ok) {
            Log::error('Refusing to store an invalid game', [
                'topic' => $topic->name, 'mechanic' => $mechanic, 'errors' => $errors,
            ]);
            return null;
        }

        return GameInstance::create([
            'topic_id'   => $topic->id,
            'topic_name' => $topic->name,
            'subject_id' => $subjectId,
            'mechanic'   => $mechanic,
            'difficulty' => $difficulty,
            'title'      => "{$topic->name} — Level {$difficulty}",
            'items'      => array_values($items),
            'validated'  => true,
        ]);
    }

    /**
     * Ask the AI service to fill this mechanic's content contract. It validates
     * in Python before returning; we treat the result as untrusted regardless.
     */
    protected function authorWithLlm(string $mechanic, string $topicName, ?string $chapterName, ?string $subjectName, int $difficulty, ?int $subjectId = null, ?int $userId = null): array
    {
        try {
            return $this->ai->authorGame([
                'mechanic'   => $mechanic,
                'topic'      => $topicName,
                'chapter'    => $chapterName,
                'subject'    => $subjectName,
                'difficulty' => $difficulty,
                'count'      => self::ITEMS_PER_GAME,
                'subject_id' => $subjectId,   // curriculum RAG grounding
                'student_id' => $userId,      // notes-first grounding
            ]);
        } catch (\Throwable $e) {
            Log::error('Game authoring failed', ['mechanic' => $mechanic, 'error' => $e->getMessage()]);
            return [];
        }
    }

    /* --------------------------- PHP authors ---------------------------- */

    /** The numeric span a difficulty operates over (mirrors `_range_for`). */
    protected function rangeFor(int $difficulty): int
    {
        return [1 => 20, 2 => 100, 3 => 500, 4 => 1000, 5 => 1000][$difficulty] ?? 100;
    }

    protected function authorDeterministic(string $mechanic, string $topicName, int $difficulty, int $seed): array
    {
        mt_srand($seed);

        $items = match ($mechanic) {
            'build_number' => $this->authorBuildNumber($difficulty),
            'compare'      => $this->authorCompare($difficulty),
            'pizza'        => $this->authorPizza(),
            default        => $this->authorNumberLine($topicName, $difficulty),
        };

        mt_srand(); // restore non-determinism for the rest of the request
        return $items;
    }

    /** The post-answer mini-lesson for an arithmetic item. */
    protected function explainNumberLine(string $op, int $a, int $b, int $result): string
    {
        return match ($op) {
            '-'     => "Start at {$a} and hop {$b} to the LEFT — you land on {$result}.",
            'x'     => "{$a} x {$b} means {$b} groups of {$a} — that makes {$result}.",
            '/'     => "{$a} shared into groups of {$b} gives {$result} groups.",
            default => "Start at {$a} and hop {$b} to the RIGHT — you land on {$result}.",
        };
    }

    /** Plausible-but-wrong numeric options, near the true answer. */
    protected function numericDistractors(int $correct, int $span): array
    {
        $out   = [];
        $delta = max(2, intdiv($span, 5));
        $guard = 0;

        while (count($out) < 3 && $guard++ < 50) {
            $cand = $correct + mt_rand(-$delta, $delta);
            if ($cand !== $correct && $cand >= 0 && ! in_array($cand, $out, true)) {
                $out[] = $cand;
            }
        }
        return array_map('strval', $out);
    }

    /** Which operation a "number_line" topic is really about. */
    protected function operationFor(string $topicName): string
    {
        $t = mb_strtolower($topicName);
        if (preg_match('/\b(subtract|subtraction|minus|difference)\b/', $t)) return '-';
        if (preg_match('/\b(multipl|times table|product)\b/', $t))           return 'x';
        if (preg_match('/\b(divid|division|quotient)\b/', $t))               return '/';
        return '+';
    }

    protected function authorNumberLine(string $topicName, int $difficulty): array
    {
        $op    = $this->operationFor($topicName);
        $hi    = $this->rangeFor($difficulty);
        $items = [];

        for ($i = 0; $i < self::ITEMS_PER_GAME; $i++) {
            switch ($op) {
                case '-':
                    $a = mt_rand(1, $hi); $b = mt_rand(1, $hi);
                    [$a, $b] = [max($a, $b), min($a, $b)];
                    $result = $a - $b;
                    break;
                case 'x':
                    $a = mt_rand(1, 10); $b = mt_rand(1, 10);
                    $result = $a * $b;
                    break;
                case '/':
                    $b = mt_rand(1, 10); $q = mt_rand(1, 10);
                    $a = $b * $q; $result = $q;
                    break;
                default:
                    $a = mt_rand(1, $hi); $b = mt_rand(1, $hi);
                    $result = $a + $b;
            }

            $max = max(20, (int) ($result * 1.25) + 5);
            $items[] = [
                'prompt'      => "{$a} {$op} {$b} = ?",
                'answer'      => (string) $result,
                'distractors' => $this->numericDistractors($result, max($result, 10)),
                'hint'        => 'Hop the marker to the answer, then lock it in.',
                'explain'     => $this->explainNumberLine($op, $a, $b, $result),
                'params'      => [
                    'kind' => 'number_line', 'op' => $op, 'a' => $a, 'b' => $b,
                    'answer' => $result, 'min' => 0, 'max' => $max,
                ],
            ];
        }
        return $items;
    }

    protected function authorBuildNumber(int $difficulty): array
    {
        // The renderer has hundreds/tens/ones columns, so stay under 1000.
        $hi    = min(999, max(101, $this->rangeFor($difficulty)));
        $items = [];

        for ($i = 0; $i < self::ITEMS_PER_GAME; $i++) {
            $num = mt_rand(100, $hi);
            $items[] = [
                'prompt'      => "Build the number {$num}",
                'answer'      => (string) $num,
                'distractors' => [],
                'hint'        => 'Drag hundreds, tens and ones until the total matches.',
                'explain'     => sprintf('%d = %d hundreds + %d tens + %d ones.', $num, intdiv($num, 100) % 10, intdiv($num, 10) % 10, $num % 10),
                'params'      => [
                    'kind' => 'build_number', 'target' => $num,
                    'hundreds' => intdiv($num, 100) % 10,
                    'tens'     => intdiv($num, 10) % 10,
                    'ones'     => $num % 10,
                ],
            ];
        }
        return $items;
    }

    protected function authorCompare(int $difficulty): array
    {
        $hi    = $this->rangeFor($difficulty);
        $items = [];

        for ($i = 0; $i < self::ITEMS_PER_GAME; $i++) {
            $a = mt_rand(1, $hi);
            $b = mt_rand(1, $hi);
            $ans = $a > $b ? '>' : ($a < $b ? '<' : '=');
            $items[] = [
                'prompt'      => "Compare: {$a} __ {$b}",
                'answer'      => $ans,
                'distractors' => array_values(array_diff(['>', '<', '='], [$ans])),
                'hint'        => 'The alligator always eats the bigger number.',
                'explain'     => $a === $b ? "{$a} and {$b} are the same size — equal!" : sprintf('%d is bigger than %d, so the alligator eats %d.', max($a, $b), min($a, $b), max($a, $b)),
                'params'      => ['kind' => 'compare', 'a' => $a, 'b' => $b],
            ];
        }
        return $items;
    }

    protected function authorPizza(): array
    {
        $items = [];
        for ($i = 0; $i < self::ITEMS_PER_GAME; $i++) {
            $parts = mt_rand(2, 8);
            $items[] = [
                'prompt'      => "A pizza is cut into {$parts} equal parts. Click ONE slice to show 1/{$parts}.",
                'answer'      => "1/{$parts}",
                'distractors' => [],
                'hint'        => 'One part out of the total equal parts.',
                'explain'     => "1/{$parts} means 1 slice out of {$parts} equal slices — the bottom number counts ALL the parts.",
                'params'      => ['kind' => 'pizza', 'parts' => $parts, 'shade' => 1],
            ];
        }
        return $items;
    }
}
