<?php

namespace Tests\Feature\Quest;

use App\Models\Chapter;
use App\Models\Level;
use App\Models\Stage;
use App\Models\Subject;
use App\Models\Topic;
use App\Models\TopicPrerequisite;
use App\Models\Track;
use App\Models\User;

/** Builds the minimal Stage→Track→Level→Subject→Chapter→Topic tree the engines traverse. */
trait BuildsCurriculum
{
    protected Subject $subject;
    /** @var Topic[] keyed by name */
    protected array $topics = [];

    /**
     * A three-topic chain A → B → C (each requires the previous), which is what
     * `quest:seed-prerequisites` produces from curriculum ordering.
     */
    protected function seedCurriculum(array $names = ['A', 'B', 'C'], bool $chain = true): void
    {
        $stage = Stage::create(['name' => 'School', 'slug' => 'school']);
        $track = Track::create(['stage_id' => $stage->id, 'name' => 'CBSE', 'slug' => 'cbse']);
        $level = Level::create(['track_id' => $track->id, 'name' => 'Class 3', 'slug' => 'class-3', 'class_number' => 3]);

        $this->subject = Subject::create(['level_id' => $level->id, 'name' => 'Mathematics', 'slug' => 'maths']);
        $chapter = Chapter::create(['subject_id' => $this->subject->id, 'name' => 'Numbers', 'slug' => 'numbers']);

        $previous = null;
        foreach (array_values($names) as $i => $name) {
            $topic = Topic::create([
                'chapter_id' => $chapter->id, 'name' => $name,
                'slug' => strtolower($name), 'position' => $i,
            ]);
            if ($chain && $previous) {
                TopicPrerequisite::create(['topic_id' => $topic->id, 'prerequisite_topic_id' => $previous->id]);
            }
            $this->topics[$name] = $topic;
            $previous = $topic;
        }
    }

    protected function student(): User
    {
        return User::create([
            'name' => 'Test Student', 'email' => 'student@test.local',
            'password' => 'secret', 'role' => 'student',
            'level_id' => $this->subject->level_id,
            // EnsureRole 403s on a falsy is_active; a fresh model instance reads
            // null (the DB default only applies after a reload), so set it here.
            'is_active' => true,
        ]);
    }
}
