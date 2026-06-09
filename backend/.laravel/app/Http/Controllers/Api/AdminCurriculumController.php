<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Chapter;
use App\Models\Level;
use App\Models\Stage;
use App\Models\Subject;
use App\Models\Topic;
use App\Models\Track;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Admin command centre for the entire curriculum hierarchy:
 * Stage → Track → Level → Subject → Chapter → Topic, all CRUD-able.
 */
class AdminCurriculumController extends Controller
{
    /** Whole tree (including inactive nodes) for the admin console. */
    public function tree()
    {
        $stages = Stage::with(['tracks' => fn ($q) => $q->orderBy('position')
            ->with(['levels' => fn ($l) => $l->orderBy('position')
                ->with(['subjects' => fn ($s) => $s->orderBy('position')
                    ->with(['chapters' => fn ($c) => $c->orderBy('position')->with('topics')])])])])
            ->orderBy('position')->get();

        return response()->json(['stages' => $stages->map(fn ($s) => $this->stageNode($s))]);
    }

    /* ----------------------------------------------------------- Stages */

    public function storeStage(Request $request)
    {
        $data = $this->validateNode($request, ['emoji', 'blurb']);
        $stage = Stage::create($this->withSlug($data, Stage::class));

        return response()->json(['stage' => $stage], 201);
    }

    public function updateStage(Request $request, Stage $stage)
    {
        $stage->update($this->validateNode($request, ['emoji', 'blurb'], false));
        return response()->json(['stage' => $stage]);
    }

    public function destroyStage(Stage $stage)
    {
        $stage->delete();
        return response()->json(['ok' => true]);
    }

    /* ----------------------------------------------------------- Tracks */

    public function storeTrack(Request $request)
    {
        $data = $this->validateNode($request, ['emoji', 'tint', 'blurb'], true, [
            'stage_id' => ['required', 'exists:stages,id'],
        ]);
        $track = Track::create($this->withSlug($data, Track::class));

        return response()->json(['track' => $track], 201);
    }

    public function updateTrack(Request $request, Track $track)
    {
        $track->update($this->validateNode($request, ['emoji', 'tint', 'blurb'], false));
        return response()->json(['track' => $track]);
    }

    public function destroyTrack(Track $track)
    {
        $track->delete();
        return response()->json(['ok' => true]);
    }

    /* ----------------------------------------------------------- Levels */

    public function storeLevel(Request $request)
    {
        $data = $request->validate([
            'track_id'     => ['required', 'exists:tracks,id'],
            'name'         => ['required', 'string', 'max:120'],
            'stream'       => ['nullable', 'string', 'max:40'],
            'class_number' => ['nullable', 'integer', 'min:1', 'max:20'],
            'position'     => ['nullable', 'integer'],
            'is_active'    => ['nullable', 'boolean'],
        ]);
        $data['slug'] = Str::slug($data['name']) ?: Str::random(6);
        $level = Level::create($data);

        return response()->json(['level' => $level], 201);
    }

    public function updateLevel(Request $request, Level $level)
    {
        $data = $request->validate([
            'name'         => ['sometimes', 'string', 'max:120'],
            'stream'       => ['sometimes', 'nullable', 'string', 'max:40'],
            'class_number' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:20'],
            'position'     => ['sometimes', 'integer'],
            'is_active'    => ['sometimes', 'boolean'],
        ]);
        if (isset($data['name'])) $data['slug'] = Str::slug($data['name']) ?: $level->slug;
        $level->update($data);

        return response()->json(['level' => $level]);
    }

    public function destroyLevel(Level $level)
    {
        $level->delete();
        return response()->json(['ok' => true]);
    }

    /* --------------------------------------------------------- Subjects */

    public function storeSubject(Request $request)
    {
        $data = $this->validateNode($request, ['emoji', 'tint', 'blurb'], true, [
            'level_id' => ['required', 'exists:levels,id'],
        ]);
        $subject = Subject::create($this->withSlug($data, Subject::class));

        return response()->json(['subject' => $subject], 201);
    }

    public function updateSubject(Request $request, Subject $subject)
    {
        $subject->update($this->validateNode($request, ['emoji', 'tint', 'blurb'], false));
        return response()->json(['subject' => $subject]);
    }

    public function destroySubject(Subject $subject)
    {
        $subject->delete();
        return response()->json(['ok' => true]);
    }

    /* --------------------------------------------------------- Chapters */

    public function storeChapter(Request $request)
    {
        $data = $this->validateNode($request, [], true, [
            'subject_id' => ['required', 'exists:subjects,id'],
        ]);
        $chapter = Chapter::create($this->withSlug($data, Chapter::class));

        return response()->json(['chapter' => $chapter], 201);
    }

    public function updateChapter(Request $request, Chapter $chapter)
    {
        $chapter->update($this->validateNode($request, [], false));
        return response()->json(['chapter' => $chapter]);
    }

    public function destroyChapter(Chapter $chapter)
    {
        $chapter->delete();
        return response()->json(['ok' => true]);
    }

    /* ----------------------------------------------------------- Topics */

    public function storeTopic(Request $request)
    {
        $data = $this->validateNode($request, [], true, [
            'chapter_id' => ['required', 'exists:chapters,id'],
        ]);
        $topic = Topic::create($this->withSlug($data, Topic::class));

        return response()->json(['topic' => $topic], 201);
    }

    public function updateTopic(Request $request, Topic $topic)
    {
        $topic->update($this->validateNode($request, [], false));
        return response()->json(['topic' => $topic]);
    }

    public function destroyTopic(Topic $topic)
    {
        $topic->delete();
        return response()->json(['ok' => true]);
    }

    /* ----------------------------------------------------- helpers */

    /**
     * Shared validation for "named node" entities. $optional lists which of
     * emoji/tint/blurb are accepted; $extra adds entity-specific rules.
     */
    private function validateNode(Request $request, array $optional, bool $creating = true, array $extra = []): array
    {
        $rules = $extra + [
            'name'      => [$creating ? 'required' : 'sometimes', 'string', 'max:160'],
            'position'  => ['sometimes', 'integer'],
            'is_active' => ['sometimes', 'boolean'],
        ];
        foreach ($optional as $field) {
            $rules[$field] = ['sometimes', 'nullable', 'string', 'max:200'];
        }

        return $request->validate($rules);
    }

    /** Build a slug that's unique for the given model (stages enforce this at the DB level). */
    private function withSlug(array $data, string $model): array
    {
        $base = Str::slug($data['name'] ?? '') ?: Str::random(6);
        $slug = $base;
        for ($i = 2; $model::where('slug', $slug)->exists(); $i++) {
            $slug = "{$base}-{$i}";
        }
        $data['slug'] = $slug;

        return $data;
    }

    /* ----------------------------------------------------- serialisers */

    private function stageNode(Stage $s): array
    {
        return [
            'id' => $s->id, 'type' => 'stage', 'name' => $s->name, 'emoji' => $s->emoji,
            'blurb' => $s->blurb, 'position' => $s->position, 'is_active' => $s->is_active,
            'tracks' => $s->tracks->map(fn ($t) => [
                'id' => $t->id, 'type' => 'track', 'name' => $t->name, 'emoji' => $t->emoji,
                'tint' => $t->tint, 'blurb' => $t->blurb, 'position' => $t->position, 'is_active' => $t->is_active,
                'levels' => $t->levels->map(fn ($l) => [
                    'id' => $l->id, 'type' => 'level', 'name' => $l->name, 'stream' => $l->stream,
                    'class_number' => $l->class_number, 'position' => $l->position, 'is_active' => $l->is_active,
                    'subjects' => $l->subjects->map(fn ($sub) => [
                        'id' => $sub->id, 'type' => 'subject', 'name' => $sub->name, 'emoji' => $sub->emoji,
                        'tint' => $sub->tint, 'blurb' => $sub->blurb, 'position' => $sub->position, 'is_active' => $sub->is_active,
                        'chapters' => $sub->chapters->map(fn ($c) => [
                            'id' => $c->id, 'type' => 'chapter', 'name' => $c->name, 'position' => $c->position,
                            'topics' => $c->topics->map(fn ($tp) => [
                                'id' => $tp->id, 'type' => 'topic', 'name' => $tp->name, 'position' => $tp->position,
                            ]),
                        ]),
                    ]),
                ]),
            ]),
        ];
    }
}
