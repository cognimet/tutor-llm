<?php

namespace Database\Seeders;

/**
 * Seeds the CURATED Grade 6 Science RAG document (NCERT "Curiosity", 22 chunks
 * across all 12 chapters: concepts, formulas, visual descriptions, exercise
 * Q&A) into the RAG knowledge base under School · CBSE · Class 6 · Science.
 *
 * Source: database/seed-data/ncert_class6_science_curated.json, produced by
 * scripts/build_curated_rag.py from
 * scripts/sources/grade_6_science_curriculum_rag_seed.md (compiled by the
 * textbook-to-rag-compiler skill). Shared logic lives in NcertContentSeeder.
 *
 * Usage:
 *   php artisan db:seed --class=Database\\Seeders\\NcertClass6ScienceCuratedContentSeeder
 *   php artisan rag:index --pending
 */
class NcertClass6ScienceCuratedContentSeeder extends NcertContentSeeder
{
    protected function jsonFile(): string
    {
        return 'seed-data/ncert_class6_science_curated.json';
    }

    protected function sourcePrefix(): string
    {
        return 'NCERT Class 6 Science (Curated)';
    }
}
