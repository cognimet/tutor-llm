<?php

namespace App\Console\Commands;

use App\Models\TopicNote;
use App\Services\NotesService;
use Illuminate\Console\Command;

/**
 * Fully delete a note and everything derived from it by id — including the
 * pieces the older UI delete left behind (diagram/anchor knowledge_nodes and
 * Qdrant vectors), which is why deleted notes kept surfacing in the tutor.
 *
 *   docker compose exec backend php artisan notes:delete 20
 *
 * Works even if the note row was already deleted via the UI: it still purges
 * the orphaned nodes, flashcards, rendered assets and vectors keyed on that id.
 */
class NotesDelete extends Command
{
    protected $signature = 'notes:delete {id : The TopicNote id to fully delete}';

    protected $description = 'Delete a note and all derived data (nodes, flashcards, assets, Qdrant vectors)';

    public function handle(NotesService $notes): int
    {
        $id = (int) $this->argument('id');
        $note = TopicNote::find($id);

        if ($note) {
            $notes->deleteNote($note);
            $this->info("Deleted note #{$id} \"{$note->title}\" and all its derived data.");
        } else {
            // Row already gone (e.g. deleted via the old UI path) — purge the
            // orphans that were left behind.
            $notes->purgeNoteData($id);
            $this->info("Note #{$id} row not found; purged orphaned nodes, flashcards, assets and vectors.");
        }

        return self::SUCCESS;
    }
}
