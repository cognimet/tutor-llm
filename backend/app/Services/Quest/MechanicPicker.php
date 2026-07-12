<?php

namespace App\Services\Quest;

/**
 * Chooses which hand-built mechanic best fits a topic.
 *
 * LearnQuest hard-coded `MECHANIC_BY_SKILL` for its 16 seed skills. This app's
 * curriculum is arbitrary (Classes 1–12, any board), so the mapping has to be
 * derived. Precedence:
 *
 *   1. `topics.mechanic` — an explicit choice by whoever authored the curriculum.
 *   2. A keyword heuristic over the topic + chapter + subject names.
 *   3. `word_match` — term-to-meaning matching, which is meaningful for any topic
 *      in any subject and can never be ambiguous once the validator has checked it.
 *
 * Deliberately deterministic and cheap: we don't spend an LLM call deciding which
 * template to use, only on filling it.
 */
class MechanicPicker
{
    /**
     * Ordered rules — first match wins, so the specific ones precede the general.
     * Each is [mechanic, regex over the lowercased "topic · chapter · subject" text].
     *
     * Patterns anchor at a word start but deliberately NOT at a word end: real
     * topic names inflect ("Comparing numbers", "Rhyming words", "Fractions"),
     * so `compar`, `rhym` and `fraction` must match as stems.
     */
    /**
     * Concept / language rules — checked FIRST and always (even for a named
     * concept), because these are the interactive, study-focused mechanics. A
     * process is best learned by ordering its steps; classification by sorting;
     * only an explicit vocabulary topic gets the passive term↔meaning match.
     */
    private const CONCEPT_RULES = [
        // Number patterns are LEARNED by extending them (see the +2 jumps, tap the
        // next term) — NOT by ordering a method's steps. Must precede `sequence`,
        // whose regex also matches "sequence".
        ['pattern',          '/\b(number (sequence|series|pattern|progression)|patterns? in number|sequences? and series|arithmetic progression|geometric progression|skip[ -]?count|visualising number|figurate|triangular number|square number)/'],
        ['sequence',         '/\b(process|procedure|steps|stages|sequence|cycle|life ?cycle|life history|reaction|method of|algorithm|timeline|chronolog|order of events|how to|derivation|working of|mechanism)/'],
        ['sort_bucket',      '/\b(classif|categor|types? of|kinds? of|sort|group|states? of matter|living|conductor|insulator)/'],
        ['sentence_builder', '/\b(sentence|grammar|syntax|tense|clause|word order|parts of speech)/'],
        ['rhyme_pick',       '/\brhym/'],
        ['word_builder',     '/\b(spelling|spell|sight word|phonics)/'],
        ['word_match',       '/\b(vocabulary|terminolog|glossary|definitions?|match the following|terms? and)/'],
    ];

    /** Arithmetic-drill rules — suppressed for named concepts (see below). */
    private const MATH_RULES = [
        ['pizza',        '/\b(fraction|numerator|denominator|part of a whole)/'],
        ['build_number', '/\b(place value|hundreds|tens and ones|expanded form)/'],
        ['compare',      '/\b(compar|greater than|less than|ascending|descending|order numbers)/'],
        ['number_line',  '/\b(addition|subtraction|multiplication|division|multiply|divid|arithmetic|number line|integer|times table)/'],
    ];

    /**
     * The universal fallback is the interactive, study-while-playing
     * complete-the-statement game (read a real syllabus fact, tap the missing
     * term) — NOT the passive term↔meaning match.
     */
    public const DEFAULT_MECHANIC = 'fill_blank';

    /**
     * Named results (a lemma, theorem, law, principle, algorithm) are CONCEPTS,
     * not arithmetic drills — "Euclid's Division Lemma" is about the relation
     * a = bq + r, not dividing random numbers. A concept keyword SUPPRESSES the
     * math rules (so "division" can't pull it into a number-line drill) but the
     * interactive concept rules and the default still apply.
     */
    private const CONCEPT_PATTERN =
        '/\b(lemma|theorem|law of|principle|algorithm|identity|identities|axiom|corollary|postulate)/';

    /**
     * @param ?string $explicit  the topic's own `mechanic` column, when set.
     */
    public function pick(?string $explicit, string $topicName, ?string $chapterName = null, ?string $subjectName = null): string
    {
        if ($explicit && in_array($explicit, GameValidator::MECHANICS, true)) {
            return $explicit;
        }

        $haystack = mb_strtolower(implode(' · ', array_filter([$topicName, $chapterName, $subjectName])));

        // Interactive concept/language mechanics first.
        foreach (self::CONCEPT_RULES as [$mechanic, $pattern]) {
            if (preg_match($pattern, $haystack)) {
                return $mechanic;
            }
        }

        // Arithmetic drills — only when the topic is NOT a named concept.
        if (! preg_match(self::CONCEPT_PATTERN, $haystack)) {
            foreach (self::MATH_RULES as [$mechanic, $pattern]) {
                if (preg_match($pattern, $haystack)) {
                    return $mechanic;
                }
            }
        }

        return self::DEFAULT_MECHANIC;
    }

    /** Is this mechanic authored in PHP (free, always correct) rather than by the LLM? */
    public function isDeterministic(string $mechanic): bool
    {
        return in_array($mechanic, GameValidator::DETERMINISTIC, true);
    }
}
