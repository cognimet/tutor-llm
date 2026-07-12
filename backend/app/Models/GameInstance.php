<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A playable game: a hand-built template mechanic + a validated content payload.
 *
 * `validated` is set only after the auto-solver in GameValidator re-solves every
 * item and agrees with its keyed answer. Nothing with validated=false is ever
 * served to a student — correctness is guaranteed by the validator, not by
 * trusting the content author (blueprint §3).
 */
class GameInstance extends Model
{
    protected $fillable = [
        'topic_id', 'topic_name', 'subject_id', 'mechanic',
        'difficulty', 'title', 'items', 'validated', 'seed',
    ];

    protected $casts = [
        'items'      => 'array',
        'validated'  => 'boolean',
        'difficulty' => 'integer',
    ];

    public function topic()   { return $this->belongsTo(Topic::class); }
    public function subject() { return $this->belongsTo(Subject::class); }
    public function events()  { return $this->hasMany(EvidenceEvent::class); }

    /**
     * The play payload: everything the client needs to render, and nothing it
     * could use to know the answer.
     *
     * `items[].answer` is the obvious secret, but the solution also hides inside
     * `params` — `word_match.pairs` *is* the pairing, `sort_bucket.items[].bin`
     * *is* the sort. Each mechanic is projected down to its renderable fields,
     * and the sides that must be matched are shuffled so their original index
     * carries no information.
     */
    public function forPlay(): array
    {
        return [
            'id'         => $this->id,
            'topic_id'   => $this->topic_id,
            'topic_name' => $this->topic_name,
            'mechanic'   => $this->mechanic,
            'difficulty' => $this->difficulty,
            'title'      => $this->title,
            'items'      => array_map(fn ($it) => [
                'prompt' => $it['prompt'] ?? '',
                'hint'   => $it['hint'] ?? '',
                'params' => $this->renderableParams(is_array($it['params'] ?? null) ? $it['params'] : []),
            ], $this->items ?? []),
        ];
    }

    /** Strip every field of `params` that encodes the solution. */
    protected function renderableParams(array $p): array
    {
        $kind = $p['kind'] ?? '';

        switch ($kind) {
            case 'number_line':   // `answer` would hand over the result outright
                return ['kind' => $kind, 'op' => $p['op'] ?? '+', 'a' => $p['a'] ?? 0,
                        'b' => $p['b'] ?? 0, 'min' => $p['min'] ?? 0, 'max' => $p['max'] ?? 20];

            case 'build_number':  // the target is already stated in the prompt
                return ['kind' => $kind];

            case 'compare':       // a and b ARE the puzzle
                return ['kind' => $kind, 'a' => $p['a'] ?? 0, 'b' => $p['b'] ?? 0];

            case 'pizza':         // `shade` is the answer
                return ['kind' => $kind, 'parts' => $p['parts'] ?? 2];

            case 'word_builder':  // `word` is the answer; the tiles are the puzzle
                return ['kind' => $kind, 'emoji' => $p['emoji'] ?? '', 'letters' => $p['letters'] ?? []];

            case 'word_match':    // the pairing is the answer — send the two columns apart
                $pairs  = $p['pairs'] ?? [];
                $rights = array_map(fn ($x) => $x['right'] ?? '', $pairs);
                shuffle($rights);
                return ['kind' => $kind,
                        'lefts'  => array_map(fn ($x) => $x['left'] ?? '', $pairs),
                        'rights' => $rights];

            case 'rhyme_pick':    // `answer` sits beside `options`
                return ['kind' => $kind, 'word' => $p['word'] ?? '', 'options' => $p['options'] ?? []];

            case 'sort_bucket':   // each item's `bin` is the answer
                $items = array_map(fn ($x) => $x['text'] ?? '', $p['items'] ?? []);
                shuffle($items);
                return ['kind' => $kind, 'bins' => $p['bins'] ?? [], 'items' => $items];

            case 'sentence_builder': // `solution` is the answer; `tiles` are shuffled already
                return ['kind' => $kind, 'tiles' => $p['tiles'] ?? []];

            case 'fill_blank':    // options include the answer (an MCQ); `answer` field is stripped
                return ['kind' => $kind, 'sentence' => $p['sentence'] ?? '', 'options' => $p['options'] ?? []];

            case 'sequence':      // `steps` is the correct order — send only the shuffled tiles
                return ['kind' => $kind, 'tiles' => $p['shuffled'] ?? []];

            case 'pattern':       // the visible terms teach the rule; the answer is one of `options`
                return ['kind' => $kind, 'terms' => $p['terms'] ?? [], 'options' => $p['options'] ?? []];

            default:
                return ['kind' => $kind];
        }
    }
}
