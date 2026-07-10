<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Services\CurriculumResolver;
use App\Services\EventTracker;
use App\Services\LearnerProfileService;
use App\Services\MindService;
use App\Services\ProgressService;
use App\Services\ReadinessService;
use App\Services\TopicProgressService;
use App\Services\TutorService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AssessmentController extends Controller
{
    public function __construct(
        protected TutorService $tutor,
        protected ProgressService $progress,
        protected MindService $mind,
        protected EventTracker $events,
        protected ReadinessService $readiness,
        protected LearnerProfileService $profile,
        protected CurriculumResolver $resolver,
        protected TopicProgressService $topicProgress,
    ) {}

    // Soft learning-gate: should the student learn this topic before testing on
    // it? Read-only; the UI nudges but never blocks (GET /assessments/readiness).
    public function readiness(Request $request)
    {
        $data = $request->validate([
            'topic_name' => ['required', 'string', 'max:160'],
            'topic_id'   => ['nullable', 'exists:topics,id'],
        ]);

        return response()->json(
            $this->readiness->check($request->user(), $data['topic_name'], $data['topic_id'] ?? null)
        );
    }

    // Generate a mini-assessment for a topic (AI).
    public function generate(Request $request)
    {
        $data = $request->validate([
            'topic_name'      => ['required', 'string', 'max:160'],
            'topic_id'        => ['nullable', 'exists:topics,id'],
            'chat_session_id' => ['nullable', 'exists:chat_sessions,id'],
            'scope'           => ['nullable', 'in:topic,exam'],
            'count'           => ['nullable', 'integer', 'min:1', 'max:20'],
        ]);

        $user = $request->user();
        // "exam" scope = a bigger, multi-concept assessment.
        $count = $data['count'] ?? (($data['scope'] ?? 'topic') === 'exam' ? 12 : 3);
        // Subject id (from the topic) makes generation notes-first — questions
        // lean on the student's own uploaded notes for this subject.
        $subjectId = $this->resolver->subjectId($user, $data['topic_id'] ?? null, null);

        // Target the student's open focus areas for THIS topic so the quiz is
        // about what they're actually struggling with — not just the topic at
        // large. Empty = a plain topic diagnostic (unchanged behaviour).
        $focusAreas = $user->knowledgeGaps()
            ->where('resolved', false)
            ->where('topic_name', $data['topic_name'])
            ->orderByRaw("CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END")
            ->limit(6)
            ->pluck('concept')
            ->filter()
            ->unique()
            ->values()
            ->all();

        $questions = $this->tutor->generateAssessment($user, $data['topic_name'], $count, $subjectId, $focusAreas);

        // Free-tier models occasionally rate-limit or return malformed JSON;
        // one immediate retry rescues most transient failures.
        if (empty($questions)) {
            $questions = $this->tutor->generateAssessment($user, $data['topic_name'], $count, $subjectId, $focusAreas);
        }

        abort_if(
            empty($questions), 422,
            'The AI couldn\'t produce a quiz just now — it may be rate-limited. '
            . 'Wait a few seconds and try again.'
        );

        $assessment = $user->assessments()->create([
            'topic_id'        => $data['topic_id'] ?? null,
            'chat_session_id' => $data['chat_session_id'] ?? null,
            'topic_name'      => $data['topic_name'],
            'status'          => 'pending',
            'total'           => count($questions),
        ]);

        foreach ($questions as $i => $q) {
            $assessment->questions()->create([
                'question'      => $q['question'],
                'options'       => $q['options'],
                'correct_index' => $q['correct_index'],
                'concept'       => $q['concept'],
                'explanation'   => $q['explanation'],
                'position'      => $i,
            ]);
        }

        // Hide correct answers from the student until they submit.
        return response()->json([
            'assessment' => [
                'id'         => $assessment->id,
                'topic_name' => $assessment->topic_name,
                'total'      => $assessment->total,
                'questions'  => $assessment->questions->map(fn ($q) => [
                    'id'       => $q->id,
                    'question' => $q->question,
                    'options'  => $q->options,
                ]),
            ],
        ], 201);
    }

    // Submit answers -> score, then detect knowledge gaps (AI).
    public function submit(Request $request, Assessment $assessment)
    {
        abort_unless($assessment->user_id === $request->user()->id, 403);
        abort_if($assessment->status === 'completed', 422, 'Assessment already submitted.');

        $data = $request->validate([
            'answers'                 => ['required', 'array', 'min:1'],
            'answers.*.question_id'   => ['required', 'exists:assessment_questions,id'],
            'answers.*.selected_index'=> ['required', 'integer', 'min:0'],
            // Optional behavioural signals (powers time/answer-change analytics).
            'answers.*.time_spent_ms' => ['nullable', 'integer', 'min:0', 'max:86400000'],
            'answers.*.answer_changes'=> ['nullable', 'integer', 'min:0', 'max:1000'],
            'answers.*.confidence'    => ['nullable', 'integer', 'min:1', 'max:5'],
        ]);

        $user = $request->user();
        $questions = $assessment->questions->keyBy('id');
        $results = [];
        $wrong = [];
        $score = 0;

        DB::transaction(function () use ($data, $questions, $user, &$results, &$wrong, &$score) {
            foreach ($data['answers'] as $a) {
                $q = $questions->get($a['question_id']);
                if (! $q) continue;
                $correct = (int) $a['selected_index'] === (int) $q->correct_index;
                $score += $correct ? 1 : 0;

                $q->answers()->create([
                    'user_id'        => $user->id,
                    'selected_index' => $a['selected_index'],
                    'is_correct'     => $correct,
                    'time_spent_ms'  => $a['time_spent_ms'] ?? null,
                    'answer_changes' => $a['answer_changes'] ?? 0,
                    'confidence'     => $a['confidence'] ?? null,
                ]);

                $results[] = [
                    'concept'    => (string) ($q->concept ?: 'General'),
                    'question'   => $q->question,
                    'is_correct' => $correct,
                ];

                // Keep wrong answers for the Mistake Notebook + flashcards.
                if (! $correct) {
                    $opts = is_array($q->options) ? $q->options : [];
                    $wrong[] = [
                        'concept'        => (string) ($q->concept ?: 'General'),
                        'question'       => $q->question,
                        'student_answer' => $opts[(int) $a['selected_index']] ?? null,
                        'correct_answer' => $opts[(int) $q->correct_index] ?? null,
                        'explanation'    => $q->explanation,
                    ];
                }
            }
        });

        $assessment->update([
            'status'       => 'completed',
            'score'        => $score,
            'completed_at' => now(),
        ]);

        // Concept-level EWMA mastery from hard evidence (alpha 0.4).
        foreach ($results as $r) {
            $this->mind->observe($user, $assessment->topic_name, $r['concept'], $r['is_correct'] ? 1.0 : 0.0);
        }

        // AI gap detection.
        $detection = $this->tutor->detectGaps($user, $assessment->topic_name, $results);

        // Mistake Notebook + spaced-repetition cards from every wrong answer.
        foreach ($wrong as $w) {
            $mistake = $user->mistakes()->create([
                'topic_id'       => $assessment->topic_id,
                'topic_name'     => $assessment->topic_name,
                'concept'        => $w['concept'],
                'question'       => $w['question'],
                'student_answer' => $w['student_answer'],
                'correct_answer' => $w['correct_answer'],
                'explanation'    => $w['explanation'],
                'source'         => 'assessment',
                'source_id'      => $assessment->id,
            ]);

            $back = trim((string) $w['correct_answer']
                . ($w['explanation'] ? "\n\n" . $w['explanation'] : ''));
            if ($back !== '') {
                $user->flashcards()->create([
                    'topic_id'    => $assessment->topic_id,
                    'topic_name'  => $assessment->topic_name,
                    'source_type' => 'mistake',
                    'source_id'   => $mistake->id,
                    'front'       => $w['question'],
                    'back'        => $back,
                    'due_at'      => now(),
                ]);
            }
        }

        foreach ($detection['gaps'] as $g) {
            $user->knowledgeGaps()->create([
                'assessment_id'  => $assessment->id,
                'topic_name'     => $assessment->topic_name,
                'concept'        => $g['concept'],
                'severity'       => $g['severity'],
                'recommendation' => $g['recommendation'],
            ]);
        }

        // Update progress: mastery nudged by this score.
        $masteryDelta = (int) round(($score / max(1, $assessment->total)) * 10) - 3;
        $this->progress->recordActivity(
            $user,
            topicsStudied: 1,
            questionsAnswered: $assessment->total,
            masteryDelta: $masteryDelta,
        );

        // Mirror the updated mastery/misconceptions into the GraphRAG mind and
        // log the assessment as a tracked event (weak concepts feed next-focus).
        $wrongConcepts = array_values(array_unique(array_map(fn ($w) => $w['concept'], $wrong)));
        $this->mind->syncToGraph($user, $assessment->topic_name);
        $this->events->track(
            $user, EventTracker::ASSESSMENT,
            "Assessment on {$assessment->topic_name}: scored {$score}/{$assessment->total}."
            . ($wrongConcepts ? ' Weak: ' . implode(', ', $wrongConcepts) . '.' : ''),
            $assessment->topic_name, $assessment->topic_id, $wrongConcepts,
            ['score' => $score, 'total' => $assessment->total],
        );

        // Recompute the learner stage and embed a snapshot into the GraphRAG
        // mind — a milestone the AI can semantically recall ("where am I now?").
        try { $this->profile->snapshot($user); } catch (\Throwable) { /* best-effort */ }

        // Roll the topic's progress + completion forward with this new evidence.
        // Best-effort: a failure here must never break submitting the quiz.
        $topicProgress = null;
        try {
            $topicProgress = $this->topicProgress->present(
                $this->topicProgress->recordAssessment($user, $assessment)
            );
        } catch (\Throwable) { /* best-effort */ }

        return response()->json([
            'score'   => $score,
            'total'   => $assessment->total,
            'summary' => $detection['summary'],
            'gaps'    => $user->knowledgeGaps()->where('assessment_id', $assessment->id)->get(),
            'mind'    => $this->mind->mind($user, $assessment->topic_name),
            'topic_progress' => $topicProgress,
            'review'  => $assessment->questions->map(fn ($q) => [
                'question'      => $q->question,
                'options'       => $q->options,
                'correct_index' => $q->correct_index,
                'explanation'   => $q->explanation,
            ]),
        ]);
    }

    public function history(Request $request)
    {
        $items = $request->user()->assessments()
            ->latest()->take(20)->get(['id', 'topic_name', 'status', 'score', 'total', 'completed_at']);

        return response()->json(['assessments' => $items]);
    }
}
