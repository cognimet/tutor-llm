<?php

namespace Database\Seeders;

use App\Models\Level;
use App\Models\Subject;

/**
 * Seeds the MBBS Year 1 Physiology textbook into the RAG knowledge base from
 * database/seed-data/mbbs_physiology.json.
 *
 * The book is a SCANNED PDF (no text layer), so the JSON is produced by the
 * vision extractor scripts/extract_physiology.py (the equivalent of the
 * scripts/extract_ncert_*.py text extractors). All shared logic lives in
 * NcertContentSeeder; we only override how the subject is resolved (MBBS isn't
 * a board+class, it's a level slug).
 *
 * Usage:
 *   python3 scripts/extract_physiology.py --pdf <pdf> --out backend/database/seed-data/mbbs_physiology.json
 *   php artisan db:seed --class=MbbsPhysiologyContentSeeder --force
 *   php artisan rag:index --pending     # push the new chunks into Qdrant
 */
class MbbsPhysiologyContentSeeder extends NcertContentSeeder
{
    protected function jsonFile(): string
    {
        return 'seed-data/mbbs_physiology.json';
    }

    protected function sourcePrefix(): string
    {
        return 'Educlub Physiology';
    }

    /** MBBS is a level slug + subject name, not a board + class number. */
    protected function findSubject(array $data): ?Subject
    {
        $level = Level::where('slug', $data['level_slug'] ?? 'mbbs-year-1')->first();

        return $level?->subjects()->where('name', $data['subject'] ?? 'Physiology')->first();
    }
}
