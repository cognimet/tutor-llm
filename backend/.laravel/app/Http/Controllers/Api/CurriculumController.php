<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Level;
use App\Models\Stage;
use Illuminate\Http\Request;

class CurriculumController extends Controller
{
    /**
     * The full Stage → Track → Level tree (no subjects) that powers the
     * cascading selector on registration / profile / admin onboarding.
     */
    public function options()
    {
        $stages = Stage::where('is_active', true)
            ->with(['tracks' => fn ($q) => $q->where('is_active', true)
                ->with(['levels' => fn ($l) => $l->where('is_active', true)->orderBy('position')])
                ->orderBy('position')])
            ->orderBy('position')->get();

        return response()->json([
            'stages' => $stages->map(fn ($s) => [
                'id'     => $s->id,
                'name'   => $s->name,
                'emoji'  => $s->emoji,
                'blurb'  => $s->blurb,
                'tracks' => $s->tracks->map(fn ($t) => [
                    'id'     => $t->id,
                    'name'   => $t->name,
                    'slug'   => $t->slug,
                    'emoji'  => $t->emoji,
                    'tint'   => $t->tint,
                    'blurb'  => $t->blurb,
                    'levels' => $t->levels->map(fn ($l) => [
                        'id'           => $l->id,
                        'name'         => $l->name,
                        'stream'       => $l->stream,
                        'class_number' => $l->class_number,
                    ]),
                ]),
            ]),
        ]);
    }

    /**
     * Subjects → chapters → topics for the authenticated student's Level.
     * Falls back to a friendly empty payload if they haven't picked one yet.
     */
    public function index(Request $request)
    {
        $user = $request->user();

        $level = $user->level_id
            ? Level::with(['track.stage', 'subjects' => fn ($q) => $q->where('is_active', true)
                ->with(['chapters' => fn ($c) => $c->with('topics')->orderBy('position')])
                ->orderBy('position')])->find($user->level_id)
            : null;

        if (! $level) {
            return response()->json([
                'level'    => null,
                'path'     => null,
                'subjects' => [],
            ]);
        }

        return response()->json([
            'level' => [
                'id'     => $level->id,
                'name'   => $level->name,
                'stream' => $level->stream,
                'track'  => $level->track?->name,
                'stage'  => $level->track?->stage?->name,
            ],
            'path'     => $level->pathLabel(),
            'subjects' => $level->subjects->map(fn ($s) => [
                'id'       => $s->id,
                'name'     => $s->name,
                'slug'     => $s->slug,
                'emoji'    => $s->emoji,
                'tint'     => $s->tint,
                'blurb'    => $s->blurb,
                'chapters' => $s->chapters->map(fn ($c) => [
                    'id'     => $c->id,
                    'name'   => $c->name,
                    'topics' => $c->topics->map(fn ($t) => ['id' => $t->id, 'name' => $t->name]),
                ]),
            ]),
        ]);
    }
}
