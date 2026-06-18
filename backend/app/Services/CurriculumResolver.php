<?php

namespace App\Services;

use App\Models\Chapter;
use App\Models\Subject;
use App\Models\Topic;
use App\Models\User;

/**
 * Resolves canonical curriculum ids from the NAMES the client already has
 * (subject / chapter / topic), scoped to the student's level so names resolve
 * unambiguously. Lets the notes + planner UIs stay name-based while the backend
 * stores real ids for scoped retrieval and the knowledge graph.
 */
class CurriculumResolver
{
    /**
     * @return array{subject_id:?int,subject_name:?string,chapter_id:?int,chapter_name:?string,topic_id:?int,topic_name:?string}
     */
    public function resolve(User $user, ?string $subjectName = null, ?string $chapterName = null,
                            ?string $topicName = null, ?int $topicId = null): array
    {
        $out = [
            'subject_id' => null, 'subject_name' => $subjectName,
            'chapter_id' => null, 'chapter_name' => $chapterName,
            'topic_id' => $topicId, 'topic_name' => $topicName,
        ];

        // Most reliable: walk up from a known topic id.
        if ($topicId) {
            $topic = Topic::with('chapter.subject')->find($topicId);
            if ($topic) {
                $out['topic_name'] = $topic->name;
                if ($ch = $topic->chapter) {
                    $out['chapter_id'] = $ch->id;
                    $out['chapter_name'] = $ch->name;
                    if ($sb = $ch->subject) {
                        $out['subject_id'] = $sb->id;
                        $out['subject_name'] = $sb->name;
                    }
                }
                return $out;
            }
        }

        // Otherwise resolve by name within the student's level.
        if ($user->level_id && $subjectName) {
            $subject = Subject::where('level_id', $user->level_id)->where('name', $subjectName)->first();
            if ($subject) {
                $out['subject_id'] = $subject->id;
                $out['subject_name'] = $subject->name;
                if ($chapterName) {
                    $chapter = Chapter::where('subject_id', $subject->id)->where('name', $chapterName)->first();
                    if ($chapter) {
                        $out['chapter_id'] = $chapter->id;
                        $out['chapter_name'] = $chapter->name;
                        if ($topicName) {
                            $topic = Topic::where('chapter_id', $chapter->id)->where('name', $topicName)->first();
                            if ($topic) {
                                $out['topic_id'] = $topic->id;
                                $out['topic_name'] = $topic->name;
                            }
                        }
                    }
                }
            }
        }

        return $out;
    }

    /** The subject id for the student's current topic/subject (for retrieval scoping). */
    public function subjectId(User $user, ?int $topicId, ?string $subjectName): ?int
    {
        if ($topicId && ($t = Topic::with('chapter')->find($topicId)) && $t->chapter) {
            return $t->chapter->subject_id;
        }
        if ($user->level_id && $subjectName) {
            return Subject::where('level_id', $user->level_id)->where('name', $subjectName)->value('id');
        }
        return null;
    }
}
