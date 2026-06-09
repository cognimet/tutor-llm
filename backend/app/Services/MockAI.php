<?php

namespace App\Services;

/**
 * Deterministic offline responses so the full flow runs with no API key.
 * The shape mirrors what TutorService expects from Gemini.
 */
class MockAI
{
    public static function text(string $system, string $user): string
    {
        $topic = self::guessTopic($user);
        return "Great question about **{$topic}**! Let's break it down step by step.\n\n"
            . "1. **The core idea** — first picture what's really going on in plain terms.\n"
            . "2. **Apply it** — we use that idea on your question.\n"
            . "3. **Watch out** — the classic mistake students make here is rushing step 2.\n\n"
            . "Quick check: can you tell me, in one line, why step 1 matters? "
            . "_(Offline demo reply — add a real GEMINI_API_KEY for live tutoring.)_";
    }

    public static function json(string $system, string $user, array $fallback = []): array
    {
        // Assessment generation
        if (str_contains($system, 'assessment') || str_contains($user, 'multiple-choice')) {
            $topic = self::guessTopic($user);
            return [
                'questions' => [
                    [
                        'question' => "Which statement best describes {$topic}?",
                        'options' => ['A core definition', 'An unrelated idea', 'A random fact', 'None of these'],
                        'correct_index' => 0,
                        'concept' => 'Definition',
                        'explanation' => 'The definition anchors everything else about the topic.',
                    ],
                    [
                        'question' => "What is the first step when applying {$topic}?",
                        'options' => ['Guess', 'Identify the given information', 'Skip ahead', 'Memorise the answer'],
                        'correct_index' => 1,
                        'concept' => 'Application',
                        'explanation' => 'Always start by identifying what you are given.',
                    ],
                    [
                        'question' => "A common mistake in {$topic} is:",
                        'options' => ['Checking units', 'Rushing without understanding', 'Drawing a diagram', 'Re-reading'],
                        'correct_index' => 1,
                        'concept' => 'Common mistakes',
                        'explanation' => 'Rushing leads to avoidable errors.',
                    ],
                ],
            ];
        }

        // Gap detection
        if (str_contains($system, 'gap') || str_contains($user, 'wrong answers')) {
            return [
                'gaps' => [
                    ['concept' => 'Application', 'severity' => 'medium',
                     'recommendation' => 'Revise how to set up the problem before solving.'],
                ],
                'summary' => 'You understand the definition well but slip when applying it. Focus practice there.',
            ];
        }

        // Learning plan
        if (str_contains($system, 'learning plan') || str_contains($user, 'next steps')) {
            return [
                'title' => 'Your focused next steps',
                'items' => [
                    ['title' => 'Watch a 5-min recap', 'detail' => 'Refresh the core definition.', 'concept' => 'Definition', 'estimated_minutes' => 5],
                    ['title' => 'Solve 3 guided examples', 'detail' => 'Practice setting up problems step by step.', 'concept' => 'Application', 'estimated_minutes' => 15],
                    ['title' => 'Re-take the mini quiz', 'detail' => 'Confirm the gap is closed.', 'concept' => 'Application', 'estimated_minutes' => 5],
                ],
            ];
        }

        return $fallback;
    }

    protected static function guessTopic(string $text): string
    {
        if (preg_match('/topic[:\s"]+([^"\n.]+)/i', $text, $m)) {
            return trim($m[1]);
        }
        return 'this topic';
    }
}
