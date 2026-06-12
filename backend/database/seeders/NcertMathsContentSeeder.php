<?php

namespace Database\Seeders;

/**
 * Seeds the full NCERT Class 10 Mathematics textbook (jemh1, all 14 chapters)
 * into the RAG knowledge base under School · CBSE · Class 10 · Mathematics.
 *
 * Source data: database/seed-data/ncert_class10_maths.json, produced by
 * scripts/extract_ncert_pdfs.py from the official NCERT chapter PDFs.
 * All shared logic lives in NcertContentSeeder.
 *
 * Usage:
 *   php artisan db:seed --class=Database\\Seeders\\NcertMathsContentSeeder
 *   php artisan rag:index --pending     # push the new chunks into Qdrant
 */
class NcertMathsContentSeeder extends NcertContentSeeder
{
    protected function jsonFile(): string
    {
        return 'seed-data/ncert_class10_maths.json';
    }

    protected function sourcePrefix(): string
    {
        return 'NCERT Class 10 Mathematics';
    }
}
