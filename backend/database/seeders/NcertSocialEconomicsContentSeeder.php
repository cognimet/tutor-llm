<?php

namespace Database\Seeders;

/**
 * Seeds NCERT Class 10 Social Science — Economics (Understanding Economic
 * Development, jess2, 5 chapters) into the RAG knowledge base under the single
 * School · CBSE · Class 10 · Social Science subject.
 *
 * Source data: database/seed-data/ncert_class10_sst_economics.json, produced by
 * scripts/extract_ncert_social.py (chapter-level topics). Shared logic lives in
 * NcertContentSeeder.
 */
class NcertSocialEconomicsContentSeeder extends NcertContentSeeder
{
    protected function jsonFile(): string
    {
        return 'seed-data/ncert_class10_sst_economics.json';
    }

    protected function sourcePrefix(): string
    {
        return 'NCERT Class 10 Social Science (Economics)';
    }
}
