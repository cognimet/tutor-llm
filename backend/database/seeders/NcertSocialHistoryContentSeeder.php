<?php

namespace Database\Seeders;

/**
 * Seeds NCERT Class 10 Social Science — History (India and the Contemporary
 * World II, jess3, 5 chapters) into the RAG knowledge base under the single
 * School · CBSE · Class 10 · Social Science subject.
 *
 * Source data: database/seed-data/ncert_class10_sst_history.json, produced by
 * scripts/extract_ncert_social.py (chapter-level topics). Shared logic lives in
 * NcertContentSeeder.
 */
class NcertSocialHistoryContentSeeder extends NcertContentSeeder
{
    protected function jsonFile(): string
    {
        return 'seed-data/ncert_class10_sst_history.json';
    }

    protected function sourcePrefix(): string
    {
        return 'NCERT Class 10 Social Science (History)';
    }
}
