<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Subject;
use App\Services\ProgressService;
use App\Services\TopicProgressService;
use Illuminate\Http\Request;

class ProgressController extends Controller
{
    public function __construct(
        protected ProgressService $progress,
        protected TopicProgressService $topicProgress,
    ) {}

    public function summary(Request $request)
    {
        return response()->json([
            'progress' => $this->progress->summary($request->user()),
            'gaps'     => $request->user()->knowledgeGaps()
                ->where('resolved', false)->latest()->get(),
        ]);
    }

    /**
     * Per-topic progress for the whole subject browser: a map keyed by both
     * "id:{topic_id}" and "name:{topic_name}", plus the student's in-progress
     * topics for a "Continue learning" strip.
     */
    public function topics(Request $request)
    {
        $user = $request->user();

        // Scope the map to the student's own curriculum topics (ids), and fall
        // back to any named rows they already have (note / whole-subject quests).
        $topicIds = Subject::where('level_id', $user->level_id)
            ->with('chapters.topics:id,chapter_id')
            ->get()
            ->flatMap(fn ($s) => $s->chapters->flatMap(fn ($c) => $c->topics->pluck('id')));

        $ownNames = $user->topicProgress()->pluck('topic_name');

        return response()->json([
            'topics'      => $this->topicProgress->mapFor($user, $topicIds, $ownNames),
            'in_progress' => $this->topicProgress->inProgress($user),
        ]);
    }

    /** Single active topic's progress (for the tutor chat header). */
    public function topic(Request $request)
    {
        $data = $request->validate([
            'topic_id'   => ['nullable', 'integer'],
            'topic_name' => ['nullable', 'string', 'max:160'],
        ]);

        return response()->json([
            'progress' => $this->topicProgress->progressFor(
                $request->user(), $data['topic_id'] ?? null, $data['topic_name'] ?? null
            ),
        ]);
    }
}
