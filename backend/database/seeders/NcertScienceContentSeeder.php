<?php

namespace Database\Seeders;

/**
 * Seeds the full NCERT Class 10 Science textbook (jesc1, all 13 chapters) into
 * the RAG knowledge base under School · CBSE · Class 10 · Science.
 *
 * Source data: database/seed-data/ncert_class10_science.json, produced by
 * scripts/extract_ncert_science.py from the official NCERT chapter PDFs.
 * All shared logic lives in NcertContentSeeder.
 *
 * Usage:
 *   php artisan db:seed --class=Database\\Seeders\\NcertScienceContentSeeder
 *   php artisan rag:index --pending     # push the new chunks into Qdrant
 */
class NcertScienceContentSeeder extends NcertContentSeeder
{
    protected function jsonFile(): string
    {
        return 'seed-data/ncert_class10_science.json';
    }

    protected function sourcePrefix(): string
    {
        return 'NCERT Class 10 Science';
    }
}
