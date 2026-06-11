<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Durable facts the tutor learns about a student (cross-session memory). */
class StudentMemory extends Model
{
    protected $table = 'student_memory';

    protected $fillable = ['user_id', 'key', 'value'];
}
