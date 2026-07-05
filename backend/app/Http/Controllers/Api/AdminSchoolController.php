<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\School;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Platform-admin onboarding of B2B2C schools. The platform creates a School and
 * its first `school_admin`; that admin then self-manages classes/teachers/students
 * via SchoolController. Mirrors the AdminUsageController / AdminGapController style.
 */
class AdminSchoolController extends Controller
{
    // List schools with seat usage for the admin console.
    public function index()
    {
        $schools = School::withCount([
            'members as students_count' => fn ($q) => $q->where('role', 'student'),
            'members as teachers_count' => fn ($q) => $q->where('role', 'teacher'),
        ])->latest()->get()->map(fn (School $s) => [
            'id'         => $s->id,
            'name'       => $s->name,
            'slug'       => $s->slug,
            'board'      => $s->board,
            'city'       => $s->city,
            'seat_limit' => $s->seat_limit,
            'seats_used' => $s->students_count,
            'teachers'   => $s->teachers_count,
            'is_active'  => $s->is_active,
        ]);

        return response()->json(['schools' => $schools]);
    }

    // Create a school shell.
    public function store(Request $request)
    {
        $data = $request->validate([
            'name'       => ['required', 'string', 'max:160'],
            'board'      => ['nullable', 'string', 'max:40'],
            'city'       => ['nullable', 'string', 'max:80'],
            'seat_limit' => ['nullable', 'integer', 'min:1'],
            'plan_id'    => ['nullable', 'exists:plans,id'],
        ]);

        $school = School::create([
            'name'       => $data['name'],
            'slug'       => $this->uniqueSlug($data['name']),
            'board'      => $data['board'] ?? null,
            'city'       => $data['city'] ?? null,
            'seat_limit' => $data['seat_limit'] ?? null,
            'plan_id'    => $data['plan_id'] ?? null,
        ]);

        return response()->json(['school' => $school], 201);
    }

    // Create (and attach) a school_admin account for a school.
    public function storeAdmin(Request $request, School $school)
    {
        $data = $request->validate([
            'name'     => ['required', 'string', 'max:120'],
            'email'    => ['required', 'email', 'unique:users,email'],
            'password' => ['required', 'string', 'min:6'],
        ]);

        $admin = User::create([
            'name'      => $data['name'],
            'email'     => $data['email'],
            'password'  => $data['password'],   // hashed cast on the model
            'role'      => 'school_admin',
            'school_id' => $school->id,
        ]);

        return response()->json([
            'message' => 'School admin created.',
            'admin'   => $admin->only(['id', 'name', 'email', 'role', 'school_id']),
        ], 201);
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'school';
        $slug = $base;
        $i = 1;
        while (School::where('slug', $slug)->exists()) {
            $slug = $base.'-'.(++$i);
        }
        return $slug;
    }
}
