<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Services\MindService;
use App\Services\ProgressService;
use App\Services\TutorService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AssessmentController extends Controller
{
    public function __construct(
        protected TutorService $tutor,
        protected ProgressService $progress,
        protected MindService $mind,
    ) {}

    // Generate a mini-assessment for a topic (AI).
    public function generate(Request $request)
    {
        $data = $request->validate([
            'topic_name'      => ['required', 'string', 'max:160'],
            'topic_id'        => ['nullable', 'exists:topics,id'],
            'chat_session_id' => ['nullable', 'exists:chat_sessions,id'],
            'count'           => ['nullable', 'integer', 'min:1', 'max:8'],
        ]);

        $user = $request->user();
        $questions = $this->tutor->generateAssessment($user, $data['topic_name'], $data['count'] ?? 3);

        abort_if(empty($questions), 422, 'Could not generate an assessment. Please try again.');

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

        // Concept-level EWMA mastery from hard evidence (alpha 0.4).
        foreach ($results as $r) {
            $this->mind->observe($user, $assessment->topic_name, $r['concept'], $r['is_correct'] ? 1.0 : 0.0);
        }

        // AI gap detection.
        $detection = $this->tutor->detectGaps($user, $assessment->topic_name, $results);

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

        return response()->json([
            'score'   => $score,
            'total'   => $assessment->total,
            'summary' => $detection['summary'],
            'gaps'    => $user->knowledgeGaps()->where('assessment_id', $assessment->id)->get(),
            'mind'    => $this->mind->mind($user, $assessment->topic_name),
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
