<?php

namespace Tests\Unit;

use App\Services\Quest\MechanicPicker;
use PHPUnit\Framework\TestCase;

/**
 * LearnQuest hard-coded skill -> mechanic. Here it's derived from the topic's
 * words, so the mapping must be sensible across a real K-12 curriculum.
 */
class MechanicPickerTest extends TestCase
{
    private MechanicPicker $picker;

    protected function setUp(): void
    {
        parent::setUp();
        $this->picker = new MechanicPicker();
    }

    public function test_an_explicit_mechanic_wins(): void
    {
        $this->assertSame('pizza', $this->picker->pick('pizza', 'Photosynthesis', 'Life Processes', 'Biology'));
    }

    public function test_an_invalid_explicit_mechanic_is_ignored(): void
    {
        $this->assertSame(MechanicPicker::DEFAULT_MECHANIC,
            $this->picker->pick('tower_defense', 'Photosynthesis', null, 'Biology'));
    }

    /** @dataProvider topicMechanics */
    public function test_it_infers_the_mechanic_from_the_topic(string $expected, string $topic, ?string $subject): void
    {
        $this->assertSame($expected, $this->picker->pick(null, $topic, null, $subject));
    }

    public static function topicMechanics(): array
    {
        return [
            'fractions'       => ['pizza', 'Introduction to Fractions', 'Mathematics'],
            'place value'     => ['build_number', 'Place value to 1000', 'Mathematics'],
            'comparing'       => ['compare', 'Comparing numbers', 'Mathematics'],
            'multiplication'  => ['number_line', 'Multiplication within 100', 'Mathematics'],
            'rhyme'           => ['rhyme_pick', 'Rhyming words', 'English'],
            'spelling'        => ['word_builder', 'Spelling patterns', 'English'],
            'grammar'         => ['sentence_builder', 'Parts of speech', 'English'],
            'classification'  => ['sort_bucket', 'States of matter', 'Science'],
            // A NUMBER-pattern topic is learned by extending the pattern, not by
            // ordering a method's steps — even though its name says "sequences".
            'number sequence' => ['pattern', 'Visualising Number Sequences', 'Mathematics'],
            'number pattern'  => ['pattern', 'Patterns in Numbers', 'Mathematics'],
            // A process/method topic is learned by ordering its steps.
            'process'         => ['sequence', 'The process of digestion', 'Biology'],
            'lifecycle'       => ['sequence', 'Life cycle of a butterfly', 'Biology'],
            'algorithm'       => ['sequence', "Euclid's Division Algorithm", 'Mathematics'],
            // Only an explicit vocabulary topic gets the passive matching game.
            'vocabulary'      => ['word_match', 'Chapter Vocabulary', 'English'],
            // Everything else conceptual → the interactive complete-the-statement game.
            'conceptual'      => ['fill_blank', 'Photosynthesis', 'Biology'],
            'history'         => ['fill_blank', 'The Mughal Empire', 'History'],
            // A named result is a concept, not a drill — "division" must NOT pull
            // "Euclid's Division Lemma" into an arithmetic number-line game.
            'lemma'           => ['fill_blank', "Euclid's Division Lemma", 'Mathematics'],
            'theorem'         => ['fill_blank', 'Pythagoras Theorem', 'Mathematics'],
            'law'             => ['fill_blank', 'Law of Reflection', 'Science'],
            // ...but an intro/visual fractions topic still gets the pizza mechanic.
            'intro fractions' => ['pizza', 'Introduction to Fractions', 'Mathematics'],
        ];
    }

    public function test_only_the_math_mechanics_are_deterministic(): void
    {
        foreach (['number_line', 'build_number', 'compare', 'pizza'] as $m) {
            $this->assertTrue($this->picker->isDeterministic($m), $m);
        }
        foreach (['word_match', 'sort_bucket', 'word_builder', 'rhyme_pick', 'sentence_builder'] as $m) {
            $this->assertFalse($this->picker->isDeterministic($m), $m);
        }
    }
}
