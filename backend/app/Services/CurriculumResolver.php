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
 *
 * Matching is fuzzy (notes_scoping_fix_spec §3.A.2): names are normalised
 * (lowercased, "Chapter 4:" prefixes stripped, punctuation removed) and matched
 * by exact-normalised, substring containment, then Levenshtein similarity — so an
 * LLM "Exploring Magnets" resolves to a stored "Chapter 4: Exploring Magnets".
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

        // 1) Most reliable: walk up from a known topic id.
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

        if (! $user->level_id || ! $subjectName) {
            return $out;
        }

        // 2) Resolve subject (fuzzy) within the student's level.
        $subjects = Subject::where('level_id', $user->level_id)->get();
        $matchedSubject = $this->findFuzzyMatch($subjectName, $subjects);

        if ($matchedSubject) {
            $out['subject_id'] = $matchedSubject->id;
            $out['subject_name'] = $matchedSubject->name;

            if ($chapterName) {
                // 3) Resolve chapter (fuzzy) within the matched subject.
                $chapters = Chapter::where('subject_id', $matchedSubject->id)->get();
                $matchedChapter = $this->findFuzzyMatch($chapterName, $chapters);

                if ($matchedChapter) {
                    $out['chapter_id'] = $matchedChapter->id;
                    $out['chapter_name'] = $matchedChapter->name;

                    if ($topicName) {
                        // 4) Resolve topic (fuzzy) within the matched chapter.
                        $topics = Topic::where('chapter_id', $matchedChapter->id)->get();
                        $matchedTopic = $this->findFuzzyMatch($topicName, $topics);

                        if ($matchedTopic) {
                            $out['topic_id'] = $matchedTopic->id;
                            $out['topic_name'] = $matchedTopic->name;
                        }
                    }
                }
            }
        }

        return $out;
    }

    /**
     * Find the best fuzzy match for $query within a collection of models with a
     * `name`, using normalised exact → containment → Levenshtein similarity.
     *
     * @param  \Illuminate\Support\Collection  $collection
     */
    protected function findFuzzyMatch(string $query, $collection)
    {
        $bestMatch = null;
        $highestScore = 0.0;

        $normalizedQuery = $this->normalize($query);
        if ($normalizedQuery === '') {
            return null;
        }

        foreach ($collection as $item) {
            $normalizedItem = $this->normalize($item->name);
            if ($normalizedItem === '') {
                continue;
            }

            // Exact match after normalisation — can't beat it.
            if ($normalizedQuery === $normalizedItem) {
                return $item;
            }

            // Direct containment either way (handles "ch 4: …" prefixes / partials).
            if (str_contains($normalizedItem, $normalizedQuery) || str_contains($normalizedQuery, $normalizedItem)) {
                $score = min(strlen($normalizedQuery), strlen($normalizedItem))
                    / max(strlen($normalizedQuery), strlen($normalizedItem));
                if ($score > $highestScore) {
                    $highestScore = $score;
                    $bestMatch = $item;
                }
            }

            // Levenshtein similarity fallback for typos / minor wording diffs.
            $lev = levenshtein($normalizedQuery, $normalizedItem);
            $maxLen = max(strlen($normalizedQuery), strlen($normalizedItem));
            $similarity = $maxLen > 0 ? (1 - ($lev / $maxLen)) : 0;

            if ($similarity > 0.70 && $similarity > $highestScore) {
                $highestScore = $similarity;
                $bestMatch = $item;
            }
        }

        return $bestMatch;
    }

    /** Lowercase, strip "Chapter X:" / "Ch X:" prefixes, remove punctuation, collapse whitespace. */
    protected function normalize(string $str): string
    {
        $str = mb_strtolower($str);
        $str = preg_replace('/^(chapter|ch)\s*\d+[:\-\s]*/', '', $str);
        $str = preg_replace('/[^\w\s]/u', ' ', $str);
        $str = preg_replace('/\s+/', ' ', $str);

        return trim($str);
    }

    /** The subject id for the student's current topic/subject (for retrieval scoping). */
    public function subjectId(User $user, ?int $topicId, ?string $subjectName): ?int
    {
        if ($topicId && ($t = Topic::with('chapter')->find($topicId)) && $t->chapter) {
            return $t->chapter->subject_id;
        }
        if ($user->level_id && $subjectName) {
            $subjects = Subject::where('level_id', $user->level_id)->get();
            $match = $this->findFuzzyMatch($subjectName, $subjects);

            return $match?->id;
        }
        return null;
    }
}
