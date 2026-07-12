<?php

namespace Tests\Unit;

use App\Models\User;
use PHPUnit\Framework\TestCase;

/**
 * The grade → primary-experience split:
 *   Kindergarten–Class 5 (0–5) → 'game' (gamified quest),
 *   Classes 6–12 and above, and advanced/unknown levels → 'chat' (AI tutor).
 *
 * Pure attribute logic, so no database is needed.
 */
class LearningModeTest extends TestCase
{
    private function student(?int $grade): User
    {
        $u = new User(['role' => 'student']);
        $u->grade = $grade;
        return $u;
    }

    /** @dataProvider grades */
    public function test_learning_mode_by_grade(?int $grade, string $expected): void
    {
        $this->assertSame($expected, $this->student($grade)->learning_mode);
    }

    public static function grades(): array
    {
        return [
            'kindergarten' => [0, 'game'],
            'class 1'  => [1, 'game'],
            'class 4'  => [4, 'game'],
            'class 5'  => [5, 'game'],   // last game grade
            'class 6'  => [6, 'chat'],   // first chat grade
            'class 7'  => [7, 'chat'],
            'class 8'  => [8, 'chat'],
            'class 9'  => [9, 'chat'],
            'class 10' => [10, 'chat'],
            'class 12' => [12, 'chat'],
            'unknown / college (no grade)' => [null, 'chat'],
        ];
    }

    public function test_non_students_default_to_chat(): void
    {
        foreach (['teacher', 'parent', 'admin', 'school_admin'] as $role) {
            $u = new User(['role' => $role]);
            $u->grade = 3; // even a "grade" shouldn't flip a non-student to game
            $this->assertSame('chat', $u->learning_mode, $role);
        }
    }

    public function test_it_is_a_different_axis_from_the_gamification_engine(): void
    {
        // Class 5: game-mode experience, but the SENIOR reward engine.
        $u = $this->student(5);
        $this->assertSame('game', $u->learning_mode);
        $this->assertSame('senior', $u->engineMode());
    }
}
