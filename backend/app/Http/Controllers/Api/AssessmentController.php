<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Models\ChatSession;
use App\Services\MasteryService;
use App\Services\ProgressService;
use App\Services\TokenMeter;
use App\Services\TutorService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The assessment half of the adaptive loop (master prompt Part E):
 * generate -> grade -> EWMA concept mastery -> gap analysis -> next attempt.
 */
class AssessmentController extends Controller
{
    public function __construct(
        protected TutorService $tutor,
        protected ProgressService $progress,
        protected MasteryService $mastery,
        protected TokenMeter $meter,
    ) {}

    // Generate a mini-assessment for a topic (AI). On attempt 2+ targets the
    // student's weak concepts with fresh questions (anti-memorization).
    public function generate(Request $request)
    {
        $data = $request->validate([
            'topic_name'      => ['required', 'string', 'max:160'],
            'topic_id'        => ['nullable', 'exists:topics,id'],
            'chat_session_id' => ['nullable', 'exists:chat_sessions,id'],
            'count'           => ['nullable', 'integer', 'min:1', 'max:8'],
        ]);

        $user = $request->user();

        // Adaptive targeting: aim attempt 2+ at the open gaps.
        $session = ! empty($data['chat_session_id'])
            ? ChatSession::find($data['chat_session_id']) : null;
        $attemptNo = $session?->attempt_no ?? 1;

        $weakConcepts = $user->knowledgeGaps()
            ->where('topic_name', $data['topic_name'])
            ->where('resolved', false)
            ->pluck('concept')->unique()->take(5)->all();

        $out = $this->tutor->generateAssessment(
            $user, $data['topic_name'], $data['count'] ?? 3, $weakConcepts, $attemptNo,
        );

        abort_if(empty($out['questions']), 422, 'Could not generate an assessment. Please try again.');

        $this->meter->meter($user, 'assess_gen', $out['usage'], $session?->id);

        $assessment = $user->assessments()->create([
            'topic_id'        => $data['topic_id'] ?? null,
            'chat_session_id' => $data['chat_session_id'] ?? null,
            'topic_name'      => $data['topic_name'],
            'status'          => 'pending',
            'total'           => count($out['questions']),
        ]);

        foreach ($out['questions'] as $i => $q) {
            $assessment->questions()->create([
                'question'      => $q['question'],
                'options'       => $q['options'],
                'correct_index' => $q['correct_index'],
                'concept'       => $q['concept'],
                'explanation'   => $q['explanation'],
                'position'      => $i,
            ]);
        }

        // Session state machine: learning -> assessing (spec D8).
        if ($session && $session->user_id === $user->id) {
            $session->update(['state' => 'assessing']);
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

    // Submit answers -> score, EWMA mastery per concept, AI gap detection,
    // and the session's next state (mastered | relearning).
    public function submit(Request $request, Assessment $assessment)
    {
        abort_unless($assessment->user_id === $request->user()->id, 403);
        abort_if($assessment->status === 'completed', 422, 'Assessment already submitted.');

        $data = $request->validate([
            'answers'                 => ['required', 'array', 'min:1'],
            'answers.*.question_id'   => ['required', 'exists:assessment_questions,id'],
            'answers.*.selected_index'=> ['required', 'integer', 'min:0'],
        ]);

        $user = $request->user();
        $questions = $assessment->questions->keyBy('id');
        $results = [];
        $score = 0;

        DB::transaction(function () use ($data, $questions, $user, &$results, &$score) {
            foreach ($data['answers'] as $a) {
                $q = $questions->get($a['question_id']);
                if (! $q) continue;
                $correct = (int) $a['selected_index'] === (int) $q->correct_index;
                $score += $correct ? 1 : 0;

                $q->answers()->create([
                    'user_id'        => $user->id,
                    'selected_index' => $a['selected_index'],
                    'is_correct'     => $correct,
                ]);

                $results[] = [
                    'concept'    => $q->concept,
                    'question'   => $q->question,
                    'is_correct' => $correct,
                ];
            }
        });

        $assessment->update([
            'status'       => 'completed',
            'score'        => $score,
            'completed_at' => now(),
        ]);

        // Concept-level EWMA mastery from hard evidence (alpha 0.4, C1).
        foreach ($results as $r) {
            $this->mastery->observe($user, $assessment->topic_name, $r['concept'], $r['is_correct'] ? 1.0 : 0.0);
        }

        // AI gap detection (root cause, not symptom).
        $detection = $this->tutor->detectGaps($user, $assessment->topic_name, $results);
        if (! empty($detection['usage'])) {
            $this->meter->meter($user, 'gap', $detection['usage'], $assessment->chat_session_id);
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

        // Adaptive loop: session moves to mastered or relearning (attempt n+1,
        // seeded with the first gap so the tutor re-teaches it differently).
        $session = $assessment->chat_session_id ? ChatSession::find($assessment->chat_session_id) : null;
        if ($session && $session->user_id === $user->id) {
            if (empty($detection['gaps'])) {
                $session->update(['state' => 'mastered', 'last_gap' => null]);
            } else {
                // Loop safety: cap auto-relearn attempts at 3 (spec D8).
                $session->update([
                    'state' => $session->attempt_no >= 3 ? 'needs_help' : 'relearning',
                    'attempt_no' => $session->attempt_no + 1,
                    'last_gap' => $detection['gaps'][0]['concept'] ?? null,
                ]);
            }
        }

        // Update progress: mastery nudged by this score.
        $masteryDelta = (int) round(($score / max(1, $assessment->total)) * 10) - 3;
        $this->progress->recordActivity(
            $user,
            topicsStudied: 1,
            questionsAnswered: $assessment->total,
            masteryDelta: $masteryDelta,
        );

        return response()->json([
            'score'   => $score,
            'total'   => $assessment->total,
            'summary' => $detection['summary'],
            'gaps'    => $user->knowledgeGaps()->where('assessment_id', $assessment->id)->get(),
            'mind'    => $this->mastery->mind($user, $assessment->topic_name, $session),
            'usage'   => $this->meter->summary($user),
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
