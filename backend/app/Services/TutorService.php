<?php

namespace App\Services;

use App\Models\User;

/**
 * Pedagogical layer. Turns product intents (teach, assess, detect gaps, plan)
 * into well-formed prompts and normalises the model output.
 */
class TutorService
{
    public function __construct(protected GeminiService $ai) {}

    public function isMock(): bool
    {
        return $this->ai->isMock();
    }

    /* ---------------- 1. AI Tutor Chat (pedagogical) ----------------- */

    /**
     * @param array $history  [['role' => 'user'|'tutor', 'content' => '...'], ...]
     */
    public function explain(User $student, string $topic, string $chapter, string $subject, array $history, string $message): string
    {
        [$system, $user] = $this->buildExplainPrompt($student, $topic, $chapter, $subject, $history, $message);

        return $this->ai->text($system, $user);
    }

    /**
     * Streaming variant of explain(). Invokes $onDelta with each text chunk and
     * returns the full reply. Returns '' if nothing streamed (caller may fall
     * back to explain()).
     */
    public function explainStream(User $student, string $topic, string $chapter, string $subject, array $history, string $message, callable $onDelta): string
    {
        [$system, $user] = $this->buildExplainPrompt($student, $topic, $chapter, $subject, $history, $message);

        return $this->ai->stream($system, $user, $onDelta);
    }

    /** Shared prompt builder for the tutor chat (text + streaming). */
    protected function buildExplainPrompt(User $student, string $topic, string $chapter, string $subject, array $history, string $message): array
    {
        $system = $this->tutorPersona($student)
            . "\nYou are tutoring strictly within this topic: \"{$topic}\" "
            . "(Chapter: {$chapter}, Subject: {$subject}). "
            . "If the student drifts off this topic, gently steer them back.\n"
            . "Teaching rules:\n"
            . "1. Explain concepts step by step, never just give the final answer.\n"
            . "2. Use a concrete example relevant to Indian school students.\n"
            . "3. Point out the common mistake students make.\n"
            . "4. End by checking the student's understanding with one short question.\n"
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

    /* ---------------- 2. Mini-assessment generation ------------------ */

    public function generateAssessment(User $student, string $topic, int $count = 3): array
    {
        $system = $this->tutorPersona($student)
            . "\nYou create a short diagnostic assessment to reveal what the student "
            . "truly understands. Return ONLY JSON.";

        $user = "Create {$count} multiple-choice questions for the topic \"{$topic}\". "
            . "Each question must probe a distinct sub-concept and include a plausible "
            . "distractor that reflects a common misconception.\n"
            . 'Return JSON of the form: '
            . '{"questions":[{"question":"...","options":["..","..","..",".."],'
            . '"correct_index":0,"concept":"sub-concept name","explanation":"why correct"}]}';

        $data = $this->ai->json($system, $user, ['questions' => []]);
        return $this->normaliseQuestions($data['questions'] ?? []);
    }

    /* ---------------- 3. Knowledge-gap detection --------------------- */

    /**
     * @param array $results  [['concept'=>.., 'question'=>.., 'is_correct'=>bool], ...]
     */
    public function detectGaps(User $student, string $topic, array $results): array
    {
        $wrong = array_values(array_filter($results, fn ($r) => empty($r['is_correct'])));

        if (empty($wrong)) {
            return [
                'gaps' => [],
                'summary' => 'No gaps detected — you answered everything correctly. Strong work!',
            ];
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
        ];
    }

    /* ---------------- 4. Personalized learning plan ------------------ */

    public function buildLearningPlan(User $student, string $topic, array $gaps): array
    {
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
            'items' => $this->normalisePlanItems($data['items'] ?? []),
        ];
    }

    /* ------------------------ helpers ------------------------------- */

    protected function tutorPersona(User $student): string
    {
        $lang = match ($student->language) {
            'hi' => 'Hindi', 'hinglish' => 'Hinglish (Hindi + English mix)', default => 'simple English',
        };

        // Prefer the precise curriculum path ("School · CBSE · Class 10 · Science",
        // "Coaching · JEE · Class 11", "Undergraduate · B.Tech CSE · Semester 3"…)
        // so answers match the exact board / exam / programme expectations.
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
            $out[] = [
                'concept'        => (string) ($g['concept'] ?? 'General'),
                'severity'       => $sev,
                'recommendation' => (string) ($g['recommendation'] ?? ''),
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
