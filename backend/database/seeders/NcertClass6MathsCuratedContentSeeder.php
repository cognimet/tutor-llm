<?php

namespace Database\Seeders;

/**
 * Seeds the CURATED Grade 6 Mathematics RAG document (16 hand-authored,
 * metadata-tagged chunks: definitions, formulas, exam-style Q&A) into the RAG
 * knowledge base under School · CBSE · Class 6 · Mathematics.
 *
 * Source: database/seed-data/ncert_class6_maths_curated.json, produced by
 * scripts/build_class6_curated_rag.py from the uploaded
 * grade_6_math_curriculum_rag_seed.md. Coexists with the PDF-extracted
 * Class 6 Maths chunks — the distinct source_ref prefix keeps the two sources'
 * idempotent deletes isolated, so retrieval draws on both.
 *
 * Usage:
 *   php artisan db:seed --class=Database\\Seeders\\NcertClass6MathsCuratedContentSeeder
 *   php artisan rag:index --pending
 */
class NcertClass6MathsCuratedContentSeeder extends NcertContentSeeder
{
    protected function jsonFile(): string
    {
        return 'seed-data/ncert_class6_maths_curated.json';
    }

    protected function sourcePrefix(): string
    {
        return 'NCERT Class 6 Mathematics (Curated)';
    }
}
