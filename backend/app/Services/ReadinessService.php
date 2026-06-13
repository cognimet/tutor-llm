<?php

namespace App\Services;

use App\Models\ConceptMastery;
use App\Models\StudyPlanTask;
use App\Models\User;

/**
 * Soft learning-gate readiness check. Answers "has the student actually learned
 * this topic before testing on it?" so the UI can nudge ("Learn this first?")
 * without ever blocking — strong students test out, weak/unstudied ones are
 * steered toward learning, then re-assess. (The Yes/No decision from the
 * design notes, implemented as a soft gate.)
 */
class ReadinessService
{
    public function __construct(protected MindService $mind) {}

    public function check(User $user, string $topic, ?int $topicId = null): array
    {
        $composite = (int) ($this->mind->mind($user, $topic)['composite_mastery'] ?? 0);

        // Match learning activity by topic NAME or id (a chat session may carry
        // either; mastery is keyed by name) so we never miss prior learning.
        $matches = function ($q) use ($topic, $topicId) {
            $q->where('topic_name', $topic);
            if ($topicId) {
                $q->orWhere('topic_id', $topicId);
            }
        };

        // "Learned" = any genuine learning activity on this topic.
        $hasChat = $user->chatSessions()->where($matches)
            ->whereHas('messages', fn ($q) => $q->where('role', 'user'))->exists();

        $hasNotes = $user->notes()->where($matches)->where('status', 'ready')->exists();

        $hasMastery = ConceptMastery::where('user_id', $user->id)
            ->where('topic_name', $topic)->where('confidence', '>', 0)->exists();

        $learnTaskDone = StudyPlanTask::whereIn('kind', ['learn', 'revise'])
            ->where('status', 'done')
            ->whereHas('plan', fn ($q) => $q->where('user_id', $user->id)->where('topic_name', $topic))
            ->exists();

        // The soft gate fires ONLY when the student hasn't engaged with the topic
        // at all. We deliberately do NOT gate on low mastery: mastery is BUILT by
        // assessing, so blocking the assessment on low mastery is circular and
        // traps a just-learned student at 0% (the bug this fixes).
        $learned = $hasChat || $hasNotes || $hasMastery || $learnTaskDone;

        return [
            'topic'           => $topic,
            'learned'         => $learned,
            'mastery'         => $composite,
            'recommend_learn' => ! $learned,
            'reason'          => $learned
                ? "You're ready — go for it."
                : "You haven't studied this topic yet — a quick learn first will make the check far more useful.",
        ];
    }
}
