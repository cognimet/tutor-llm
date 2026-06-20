<?php

namespace Database\Seeders;

/**
 * Seeds NCERT Class 6 Mathematics — Ganita Prakash (fegp1, 10 chapters) into the
 * RAG knowledge base under School · CBSE · Class 6 · Mathematics.
 *
 * Source data: database/seed-data/ncert_class6_maths.json, produced by
 * scripts/extract_ncert_class6_maths.py. Shared logic lives in NcertContentSeeder.
 *
 * Usage:
 *   php artisan db:seed --class=Database\\Seeders\\NcertClass6MathsContentSeeder
 *   php artisan rag:index --pending
 */
class NcertClass6MathsContentSeeder extends NcertContentSeeder
{
    protected function jsonFile(): string
    {
        return 'seed-data/ncert_class6_maths.json';
    }

    protected function sourcePrefix(): string
    {
        return 'NCERT Class 6 Mathematics';
    }
}
