<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\EventTracker;
use Illuminate\Http\Request;

/**
 * Lightweight behavioural telemetry from the client: time-on-topic, panel
 * opens, screen focus, hint usage. Funnelled through EventTracker (logged +
 * graphed for the learner profile) but NOT embedded — these are high-frequency
 * structural signals, aggregated into the stage, not semantically retrieved.
 */
class TelemetryController extends Controller
{
    private const ALLOWED = [
        EventTracker::TOPIC_TIME,
        EventTracker::PANEL_OPEN,
        EventTracker::SCREEN_FOCUS,
        EventTracker::HINT_USED,
    ];

    public function __construct(protected EventTracker $events) {}

    /** POST /tutor/telemetry  { events: [{type, topic_name?, topic_id?, duration_ms?, meta?}] } */
    public function store(Request $request)
    {
        $data = $request->validate([
            'events'                => ['required', 'array', 'max:50'],
            'events.*.type'         => ['required', 'string', 'max:40'],
            'events.*.topic_name'   => ['nullable', 'string', 'max:160'],
            'events.*.topic_id'     => ['nullable', 'integer'],
            'events.*.duration_ms'  => ['nullable', 'integer', 'min:0', 'max:86400000'],
            'events.*.meta'         => ['nullable', 'array'],
        ]);

        $user = $request->user();
        foreach ($data['events'] as $e) {
            if (! in_array($e['type'], self::ALLOWED, true)) {
                continue;
            }
            $topic = $e['topic_name'] ?? null;
            $dur = $e['duration_ms'] ?? null;
            $meta = $e['meta'] ?? [];
            $this->events->track(
                $user, $e['type'], $this->text($e['type'], $topic, $dur, $meta),
                $topic, $e['topic_id'] ?? null, [], $meta,
                embed: false, durationMs: $dur,
            );
        }

        return response()->json(['ok' => true]);
    }

    protected function text(string $type, ?string $topic, ?int $dur, array $meta): string
    {
        return match ($type) {
            EventTracker::TOPIC_TIME => 'Spent ' . $this->hms($dur) . ' on ' . ($topic ?? 'a topic'),
            EventTracker::PANEL_OPEN => 'Opened the ' . ($meta['tab'] ?? 'study') . ' panel' . ($topic ? " for {$topic}" : ''),
            EventTracker::HINT_USED  => 'Used a hint' . ($topic ? " on {$topic}" : ''),
            default                  => ucfirst(str_replace('_', ' ', $type)),
        };
    }

    protected function hms(?int $ms): string
    {
        $s = (int) round(($ms ?? 0) / 1000);
        return $s >= 60 ? intdiv($s, 60) . 'm ' . ($s % 60) . 's' : "{$s}s";
    }
}
