<?php

namespace App\Console\Commands;

use App\Services\RagIndexer;
use Illuminate\Console\Command;

/**
 * Index curriculum content into the vector store.
 *   php artisan rag:index            # all chunks
 *   php artisan rag:index --pending  # only chunks not yet indexed
 */
class RagIndex extends Command
{
    protected $signature = 'rag:index {--pending : Only index chunks not yet in the vector store}';
    protected $description = 'Embed and index curriculum content_chunks into the vector store';

    public function handle(RagIndexer $indexer): int
    {
        $this->info('Indexing curriculum into the vector store…');
        $count = $indexer->indexAll(
            onlyPending: (bool) $this->option('pending'),
            progress: fn ($n) => $this->output->write("\r  indexed: {$n}"),
        );
        $this->newLine();
        $this->info("✅ Done. {$count} chunk(s) indexed.");

        return self::SUCCESS;
    }
}
