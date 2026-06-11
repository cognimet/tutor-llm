<?php

namespace App\Services;

use App\Models\User;

/**
 * Pedagogical orchestrator. Primary path: the Python AI service (FastAPI),
 * which owns all prompts, RAG and token accounting. Fallback path: direct
 * Gemini with local prompts, so the product still works when the AI service
 * isn't running (e.g. bare `php artisan serve` without docker).
 *
 * Every method returns a `usage` array {prompt_tokens, completion_tokens,
 * model} the caller must pass to TokenMeter::meter().
 */
class TutorService
{
    public function __construct(
        protected AiService $svc,
        protected GeminiService $ai,
    ) {}

    public function isMock(): bool
    {
        return ! $this->svc->enabled() && $this->ai->isMock();
    }

    /* ---------------- 1. AI Tutor Chat (pedagogical) ----------------- */

    /**
     * One tutor turn, non-streaming.
     *
     * $ctx: [topic, chapter, subject, mode, attempt_no, last_gap]
     * @return array{reply: string, meta: array, usage: array}
     */
    public function turn(User $student, array $ctx, array $history, string $message): array
    {
        if ($this->svc->enabled()) {
            $out = $this->svc->chatTurn($this->turnPayload($student, $ctx, $history, $message));
            if ($out !== null && ($out['reply'] ?? '') !== '') {
                return [
                    'reply' => $out['reply'],
                    'meta' => $out['meta'] ?? [],
                    'usage' => $out['usage'] ?? [],
                ];
            }
        }

        // Fallback: direct Gemini with local prompts (no structured meta).
        [$system, $user] = $this->buildExplainPrompt($student, $ctx, $history, $message);
        $reply = $this->ai->text($system, $user);

        return ['reply' => $reply, 'meta' => [], 'usage' => $this->estimateUsage($system . $user, $reply)];
    }

    /**
     * Streaming tutor turn: $onDelta receives text chunks; returns the final
     * {reply, meta, usage}. Reply is '' if nothing was produced.
     */
    public function turnStream(User $student, array $ctx, array $history, string $message, callable $onDelta): array
    {
        if ($this->svc->enabled()) {
            $out = $this->svc->chatTurnStream($this->turnPayload($student, $ctx, $history, $message), $onDelta);
            if ($out !== null && ($out['reply'] ?? '') !== '') {
                return [
                    'reply' => $out['reply'],
                    'meta' => $out['meta'] ?? [],
                    'usage' => $out['usage'] ?? [],
                ];
            }
        }

        [$system, $user] = $this->buildExplainPrompt($student, $ctx, $history, $message);
        $reply = $this->ai->stream($system, $user, $onDelta);

        if ($reply === '') {
            // Streaming produced nothing (transient upstream error) — retrying
            // non-streaming path so the student still gets an answer.
            $reply = $this->ai->text($system, $user);
            if ($reply !== '') {
                $onDelta($reply);
            }
        }

        return ['reply' => $reply, 'meta' => [], 'usage' => $this->estimateUsage($system . $user, $reply)];
    }

    /* ---------------- 2. Mini-assessment generation ------------------ */

    /** @return array{questions: array, usage: array} */
    public function generateAssessment(User $student, string $topic, int $count = 3, array $concepts = [], int $attemptNo = 1): array
    {
        if ($this->svc->enabled()) {
            $out = $this->svc->generateAssessment([
                'student' => $this->svc->studentContext($student, $topic),
                'topic' => $topic,
                'count' => $count,
                'concepts' => array_values($concepts),
                'attempt_no' => $attemptNo,
            ]);
            if ($out !== null) {
                return [
                    'questions' => $this->normaliseQuestions($out['questions'] ?? []),
                    'usage' => $out['usage'] ?? [],
                ];
            }
        }

        $system = $this->tutorPersona($student)
            . "\nYou create a short diagnostic assessment to reveal what the student "
            . "truly understands. Return ONLY JSON.";

        $focus = empty($concepts) ? '' :
            'Target these weak concepts: ' . implode(', ', $concepts) . '. ';
        $fresh = $attemptNo > 1
            ? "This is attempt {$attemptNo}; generate FRESH questions the student has not seen. " : '';

        $user = "Create {$count} multiple-choice questions for the topic \"{$topic}\". {$focus}{$fresh}"
            . "Each question must probe a distinct sub-concept and include a plausible "
            . "distractor that reflects a common misconception.\n"
            . 'Return JSON of the form: '
            . '{"questions":[{"question":"...","options":["..","..","..",".."],'
            . '"correct_index":0,"concept":"sub-concept name","explanation":"why correct"}]}';

        $data = $this->ai->json($system, $user, ['questions' => []]);

        return [
            'questions' => $this->normaliseQuestions($data['questions'] ?? []),
            'usage' => $this->estimateUsage($system . $user, json_encode($data)),
        ];
    }

    /* ---------------- 3. Knowledge-gap detection --------------------- */

    /**
     * @param array $results [['concept'=>.., 'question'=>.., 'is_correct'=>bool], ...]
     * @return array{gaps: array, summary: string, usage: array}
     */
    public function detectGaps(User $student, string $topic, array $results): array
    {
        $wrong = array_values(array_filter($results, fn ($r) => empty($r['is_correct'])));

        if (empty($wrong)) {
            return [
                'gaps' => [],
                'summary' => 'No gaps detected — you answered everything correctly. Strong work!',
                'usage' => [],
            ];
        }

        if ($this->svc->enabled()) {
            $out = $this->svc->analyzeGaps([
                'student' => $this->svc->studentContext($student, $topic),
                'topic' => $topic,
                'results' => $wrong,
            ]);
            if ($out !== null) {
                return [
                    'gaps' => $this->normaliseGaps($out['gaps'] ?? []),
                    'summary' => (string) ($out['summary'] ?? ''),
                    'usage' => $out['usage'] ?? [],
                ];
            }
        }

        $system = $this->tutorPersona($student)
            . "\nYou analyse a student's wrong answers to detect knowledge gaps. Return ONLY JSON.";

        $lines = '';
        foreach ($wrong as $r) {
            $lines .= "- Concept: {$r['concept']} | Question: {$r['question']}\n";
        }

        $user = "Topic: \"{$topic}\". The student got these wrong answers:\n{$lines}\n"
            . "Identify the underlying knowledge gaps. For each, give a severity "
            . "(low|medium|high) and a one-line recommendation.\n"
            . 'Return JSON: {"gaps":[{"concept":"..","severity":"medium","recommendation":".."}],'
            . '"summary":"one short paragraph for the student"}';

        $data = $this->ai->json($system, $user, ['gaps' => [], 'summary' => '']);

        return [
            'gaps' => $this->normaliseGaps($data['gaps'] ?? []),
            'summary' => (string) ($data['summary'] ?? ''),
            'usage' => $this->estimateUsage($system . $user, json_encode($data)),
        ];
    }

    /* ---------------- 4. Personalized learning plan ------------------ */

    /** @return array{title: string, rationale: string, items: array, usage: array} */
    public function buildLearningPlan(User $student, string $topic, array $gaps): array
    {
        if ($this->svc->enabled()) {
            $out = $this->svc->buildPlan([
                'student' => $this->svc->studentContext($student, $topic),
                'topic' => $topic,
                'gaps' => array_values($gaps),
            ]);
            if ($out !== null) {
                return [
                    'title' => (string) ($out['title'] ?? 'Your next steps'),
                    'rationale' => (string) ($out['rationale'] ?? ''),
                    'items' => $this->normalisePlanItems($out['items'] ?? []),
                    'usage' => $out['usage'] ?? [],
                ];
            }
        }

        $system = $this->tutorPersona($student)
            . "\nYou design a light, motivating learning plan (next steps). Return ONLY JSON.";

        $gapText = empty($gaps)
            ? 'The student has no major gaps; suggest light reinforcement.'
            : 'Focus on these gaps: ' . implode(', ', array_map(fn ($g) => $g['concept'] ?? '', $gaps)) . '.';

        $user = "Topic: \"{$topic}\". {$gapText}\n"
            . "Create 3-4 short, concrete next-step tasks. Keep each under 20 minutes.\n"
            . 'Return JSON: {"title":"..","items":[{"title":"..","detail":"..","concept":"..","estimated_minutes":15}]}';

        $data = $this->ai->json($system, $user, ['title' => 'Your next steps', 'items' => []]);

        return [
            'title' => (string) ($data['title'] ?? 'Your next steps'),
            'rationale' => '',
            'items' => $this->normalisePlanItems($data['items'] ?? []),
            'usage' => $this->estimateUsage($system . $user, json_encode($data)),
        ];
    }

    /* ---------------- 5. Parent report (plain language) -------------- */

    /** @return array{report: array, usage: array} */
    public function parentReport(User $student, string $period, array $stats): array
    {
        if ($this->svc->enabled()) {
            $out = $this->svc->parentReport([
                'student' => $this->svc->studentContext($student),
                'period' => $period,
                'stats' => $stats,
            ]);
            if ($out !== null && ! empty($out['report'])) {
                return ['report' => $out['report'], 'usage' => $out['usage'] ?? []];
            }
        }

        $system = 'You write a short, plain-language progress report for a non-technical '
            . 'Indian parent reading on a phone. Warm, honest, specific. Return ONLY JSON.';
        $user = 'Student: ' . $student->name . '. Period: ' . $period . '. Data: ' . json_encode($stats) . "\n"
            . 'Return JSON: {"headline":"..","summary":"..","wins":["..."],'
            . '"focus_areas":["..."],"suggestion":".."}';

        $data = $this->ai->json($system, $user, []);

        return ['report' => $data, 'usage' => $this->estimateUsage($system . $user, json_encode($data))];
    }

    /* ------------------------ helpers ------------------------------- */

    protected function turnPayload(User $student, array $ctx, array $history, string $message): array
    {
        return [
            'student' => $this->svc->studentContext($student, $ctx['topic'] ?? null),
            'topic' => (string) ($ctx['topic'] ?? ''),
            'chapter' => (string) ($ctx['chapter'] ?? ''),
            'subject' => (string) ($ctx['subject'] ?? ''),
            'mode' => (string) ($ctx['mode'] ?? 'teach'),
            'attempt_no' => (int) ($ctx['attempt_no'] ?? 1),
            'last_gap' => $ctx['last_gap'] ?? null,
            'history' => array_map(fn ($m) => [
                'role' => ($m['role'] ?? '') === 'user' ? 'user' : 'tutor',
                'content' => (string) ($m['content'] ?? ''),
            ], $history),
            'message' => $message,
        ];
    }

    /** Fallback-path usage estimate (~4 chars/token) so nothing runs unmetered. */
    protected function estimateUsage(string $prompt, ?string $output): array
    {
        return [
            'prompt_tokens' => (int) max(1, mb_strlen($prompt) / 4),
            'completion_tokens' => (int) max(1, mb_strlen((string) $output) / 4),
            'model' => $this->ai->isMock() ? 'mock' : (string) config('gemini.model'),
        ];
    }

    /** Shared prompt builder for the fallback tutor chat (text + streaming). */
    protected function buildExplainPrompt(User $student, array $ctx, array $history, string $message): array
    {
        $topic = (string) ($ctx['topic'] ?? '');
        $chapter = (string) ($ctx['chapter'] ?? '');
        $subject = (string) ($ctx['subject'] ?? '');
        $mode = (string) ($ctx['mode'] ?? 'teach');

        $modeRules = match ($mode) {
            'socratic' => "NEVER explain directly. Respond ONLY with guiding questions (1-2 per turn) "
                . "that lead the student to discover the idea themselves.\n",
            'quiz' => "Ask one short question at a time, wait for the answer, grade it kindly, "
                . "explain briefly, then ask the next.\n",
            'exam' => "Pose exam-style questions in board-exam phrasing with marks weighting. "
                . "Grade strictly and give one exam-technique tip per question.\n",
            'eli10' => "Explain like the student is 10 years old — short sentences, everyday "
                . "analogies, zero jargon. End with a one-line 'grown-up version'.\n",
            default => "1. Explain concepts step by step, never just give the final answer.\n"
                . "2. Use a concrete example relevant to Indian school students.\n"
                . "3. Point out the common mistake students make.\n"
                . "4. End by checking the student's understanding with one short question.\n",
        };

        $system = $this->tutorPersona($student)
            . "\nYou are tutoring strictly within this topic: \"{$topic}\" "
            . "(Chapter: {$chapter}, Subject: {$subject}). "
            . "If the student drifts off this topic, gently steer them back.\n"
            . "Teaching rules:\n" . $modeRules
            . "Formatting: use clear Markdown — short paragraphs, **bold** for key terms, "
            . "bullet or numbered lists for steps, and `inline code` for variables. "
            . "Write mathematics in LaTeX: inline as \$...\$ and display equations as \$\$...\$\$. "
            . "Keep it concise and encouraging.";

        $convo = '';
        foreach ($history as $m) {
            $who = ($m['role'] ?? '') === 'user' ? 'Student' : 'Tutor';
            $convo .= "{$who}: {$m['content']}\n";
        }
        $user = "Topic: \"{$topic}\"\n\nConversation so far:\n{$convo}\nStudent: {$message}\n\nTutor:";

        return [$system, $user];
    }

    protected function tutorPersona(User $student): string
    {
        $lang = match ($student->language) {
            'hi' => 'Hindi', 'hinglish' => 'Hinglish (Hindi + English mix)', default => 'simple English',
        };

        $path = $student->curriculum_path;
        $context = $path
            ? "a learner in the Indian education system studying: {$path}"
            : 'a Class ' . ($student->grade ?? 10) . ' ' . strtoupper($student->board ?? 'CBSE') . ' student in India';

        return "You are 'Tuto', a warm, patient AI teacher for {$context}. "
            . "Calibrate the depth, vocabulary, examples and exam framing precisely to that level "
            . "(e.g. board exams for school, entrance patterns for coaching, university rigour for college). "
            . "Explain in {$lang}.";
    }

    protected function normaliseQuestions(array $items): array
    {
        $out = [];
        foreach ($items as $q) {
            $options = array_values((array) ($q['options'] ?? []));
            if (count($options) < 2) continue;
            $idx = (int) ($q['correct_index'] ?? 0);
            $idx = max(0, min($idx, count($options) - 1));
            $out[] = [
                'question'      => (string) ($q['question'] ?? ''),
                'options'       => $options,
                'correct_index' => $idx,
                'concept'       => (string) ($q['concept'] ?? 'General'),
                'explanation'   => (string) ($q['explanation'] ?? ''),
                'misconception' => (string) ($q['misconception'] ?? ''),
            ];
        }
        return $out;
    }

    protected function normaliseGaps(array $items): array
    {
        $out = [];
        foreach ($items as $g) {
            $sev = strtolower($g['severity'] ?? 'medium');
            if (! in_array($sev, ['low', 'medium', 'high'], true)) $sev = 'medium';
            $rec = (string) ($g['recommendation'] ?? '');
            if (! empty($g['root_cause'])) {
                $rec = trim('Root cause: ' . $g['root_cause'] . '. ' . $rec);
            }
            $out[] = [
                'concept'        => (string) ($g['concept'] ?? 'General'),
                'severity'       => $sev,
                'recommendation' => $rec,
            ];
        }
        return $out;
    }

    protected function normalisePlanItems(array $items): array
    {
        $out = [];
        foreach ($items as $i) {
            $out[] = [
                'title'             => (string) ($i['title'] ?? 'Study task'),
                'detail'            => (string) ($i['detail'] ?? ''),
                'concept'           => (string) ($i['concept'] ?? ''),
                'estimated_minutes' => max(1, (int) ($i['estimated_minutes'] ?? 15)),
            ];
        }
        return $out;
    }
}
