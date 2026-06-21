<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\GamificationService;
use Illuminate\Http\Request;

/**
 * Universal (Dual-Engine) Gamification API — spec §8.
 *
 * Senior (Classes 5–10) reads XP / level / trophies; Junior (Classes 1–4) reads
 * Magic Stars / companion / sticker book. The frontend reads profile() for the
 * dashboard header and calls claimReward() on a quest milestone to drive the
 * celebration overlay. The legacy stats()/reward() endpoints remain for the
 * existing "Study from my notes" flow.
 */
class GamificationController extends Controller
{
    public function __construct(protected GamificationService $gamify) {}

    /* ------------------------------------------------ legacy quest-flow API */

    /** GET /tutor/me/gamification — compact XP/level/rank/streak/badges. */
    public function stats(Request $request)
    {
        return response()->json($this->gamify->stats($request->user()));
    }

    /** POST /tutor/quest/reward — award XP for a whitelisted quest action. */
    public function reward(Request $request)
    {
        $data = $request->validate([
            'action'  => ['required', 'string', 'in:start_quest,answer_correct,master_concept,complete_quest,complete_plan,perfect_quiz,chapter_quest,chat_explainer,correct_note,help_peer'],
            'topic'   => ['nullable', 'string', 'max:160'],
            'perfect' => ['nullable', 'boolean'],
            'formula_heavy' => ['nullable', 'boolean'],
        ]);

        $reward = $this->gamify->award($request->user(), $data['action'], [
            'topic'         => $data['topic'] ?? null,
            'perfect'       => (bool) ($data['perfect'] ?? false),
            'formula_heavy' => (bool) ($data['formula_heavy'] ?? false),
        ]);

        return response()->json($reward);
    }

    /* --------------------------------------------------- spec §8 dual-engine */

    /** GET /gamification/profile — full engine-aware profile (spec §8.1). */
    public function profile(Request $request)
    {
        return response()->json([
            'status' => 'success',
            'data'   => $this->gamify->profilePayload($request->user()),
        ]);
    }

    /** POST /gamification/claim-reward — claim points for an activity (spec §8.2). */
    public function claimReward(Request $request)
    {
        $data = $request->validate([
            'activity_type' => ['required', 'string', 'in:start_quest,answer_correct,master_concept,complete_quest,complete_plan,quest_completion,perfect_quiz,chapter_quest,chat_explainer,correct_note,help_peer,daily_streak'],
            'task_id'       => ['nullable', 'integer'],
            'topic'         => ['nullable', 'string', 'max:160'],
            'perfect'       => ['nullable', 'boolean'],
        ]);

        // 'quest_completion' (spec wording) maps to our chapter_quest reward.
        $action = $data['activity_type'] === 'quest_completion' ? 'chapter_quest' : $data['activity_type'];

        $reward = $this->gamify->claim($request->user(), $action, [
            'topic'   => $data['topic'] ?? null,
            'perfect' => (bool) ($data['perfect'] ?? false),
        ]);

        return response()->json([
            'status'        => 'success',
            'points_earned' => $reward['points_gained'],
            'currency'      => $reward['currency'],
            'streak_updated'=> [
                'current'          => $reward['streak'],
                'milestone_reached'=> $reward['streak'] > 0 && $reward['streak'] % 5 === 0,
            ],
            'level_up_triggered' => [
                'triggered'         => $reward['leveled_up'],
                'new_level'         => $reward['level'],
                'rewards_unlocked'  => [
                    'stickers_unlocked' => array_column($reward['new_stickers'], 'key'),
                    'trophies_unlocked' => array_column($reward['new_trophies'], 'key'),
                ],
            ],
            'reward' => $reward,
        ]);
    }

    /** GET /gamification/stickers — unlocked sticker catalog (spec §8.3). */
    public function stickers(Request $request)
    {
        return response()->json([
            'status' => 'success',
            'data'   => $this->gamify->stickerCatalog($request->user()),
        ]);
    }

    /** POST /gamification/stickers/place — save a canvas placement (spec §8.4). */
    public function placeSticker(Request $request)
    {
        $data = $request->validate([
            'sticker_id'            => ['required', 'integer'],
            'placement'             => ['required', 'array'],
            'placement.is_placed'   => ['required', 'boolean'],
            'placement.placed_x'    => ['nullable', 'numeric'],
            'placement.placed_y'    => ['nullable', 'numeric'],
            'placement.canvas_scale'=> ['nullable', 'numeric'],
        ]);

        $ok = $this->gamify->placeSticker($request->user(), $data['sticker_id'], $data['placement']);

        return response()->json(['status' => $ok ? 'success' : 'error'], $ok ? 200 : 404);
    }

    /** POST /gamification/companion/interact — feed / pat Tuto (spec §8.5). */
    public function companionInteract(Request $request)
    {
        $data = $request->validate([
            'interaction_type' => ['required', 'string', 'in:feed,pat'],
            'item_key'         => ['nullable', 'string', 'max:60'],
        ]);

        $result = $this->gamify->interactCompanion(
            $request->user(), $data['interaction_type'], $data['item_key'] ?? null,
        );

        return response()->json(['status' => 'success'] + $result);
    }

    /** POST /gamification/shield — buy a Senior streak shield (spec §3.3). */
    public function buyShield(Request $request)
    {
        $result = $this->gamify->buyShield($request->user());
        return response()->json($result, $result['ok'] ? 200 : 422);
    }
}
