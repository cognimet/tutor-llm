<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EngagementEvent;
use App\Models\User;
use App\Services\AnalyticsService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Analytics + insights API for all three audiences, plus the engagement/
 * integrity ingest endpoint the in-assessment tracker batches to.
 */
class AnalyticsController extends Controller
{
    public function __construct(protected AnalyticsService $analytics) {}

    private function days(Request $r): int
    {
        return min(90, max(7, (int) $r->query('days', 30)));
    }

    /** GET /me/analytics — the signed-in student's dashboard. */
    public function me(Request $request)
    {
        return response()->json($this->analytics->userAnalytics($request->user(), $this->days($request)));
    }

    /** GET /parent/children/{child}/analytics — guarded to the parent's own child. */
    public function child(Request $request, User $child)
    {
        abort_unless(
            $request->user()->children()->whereKey($child->id)->exists(),
            403, 'Not your child.'
        );
        return response()->json($this->analytics->childAnalytics($child, $this->days($request)));
    }

    /** GET /admin/analytics — system-wide. */
    public function system(Request $request)
    {
        return response()->json($this->analytics->adminAnalytics($this->days($request)));
    }

    /**
     * POST /engagement — batched behavioural/integrity pings from the client.
     * { events: [{type, assessment_id?, chat_session_id?, question_id?, duration_ms?, meta?, ts?}] }
     */
    public function ingest(Request $request)
    {
        $data = $request->validate([
            'events'                  => ['required', 'array', 'max:100'],
            'events.*.type'           => ['required', 'string', 'max:40'],
            'events.*.assessment_id'  => ['nullable', 'integer'],
            'events.*.chat_session_id' => ['nullable', 'integer'],
            'events.*.question_id'    => ['nullable', 'integer'],
            'events.*.duration_ms'    => ['nullable', 'integer', 'min:0', 'max:86400000'],
            'events.*.meta'           => ['nullable', 'array'],
            'events.*.ts'             => ['nullable', 'numeric'],
        ]);

        $allowed = [
            EngagementEvent::TAB_BLUR, EngagementEvent::TAB_FOCUS, EngagementEvent::QUESTION_VIEW,
            EngagementEvent::ANSWER_CHANGE, EngagementEvent::SECTION_TIME, EngagementEvent::ASSESSMENT_START,
            EngagementEvent::ASSESSMENT_SUBMIT, EngagementEvent::DROP_OFF, EngagementEvent::CONFIDENCE,
        ];

        $uid = $request->user()->id;
        $rows = [];
        foreach ($data['events'] as $e) {
            if (! in_array($e['type'], $allowed, true)) {
                continue;
            }
            $rows[] = [
                'user_id'         => $uid,
                'assessment_id'   => $e['assessment_id'] ?? null,
                'chat_session_id' => $e['chat_session_id'] ?? null,
                'question_id'     => $e['question_id'] ?? null,
                'event_type'      => $e['type'],
                'duration_ms'     => $e['duration_ms'] ?? null,
                'meta'            => isset($e['meta']) ? json_encode($e['meta']) : null,
                'created_at'      => isset($e['ts'])
                    ? Carbon::createFromTimestampMs((int) $e['ts'])
                    : now(),
            ];
        }
        if ($rows) {
            EngagementEvent::insert($rows);
        }

        return response()->json(['ok' => true, 'stored' => count($rows)]);
    }
}
