<?php

namespace App\Console\Commands;

use App\Models\TopicNote;
use App\Services\NotesService;
use Illuminate\Console\Command;

/**
 * Backfill the Diagram Isolation upgrade onto notes uploaded BEFORE it shipped.
 *
 * A pre-upgrade diagram row has no isolated cut (and its old crops may have been
 * cleared from the shared volume), so the Visual Context Viewer shows "No stored
 * image". This re-runs ONLY diagram ingestion for a note — segmentation →
 * isolated_diagram.png → anchor text — writing fresh assets to the shared
 * volume. Idempotent (updateOrCreate on deterministic qdrant_ids): safe to
 * re-run, never duplicates nodes, and does NOT re-mint the note's flashcards.
 *
 *   # one note (the id the tutor referenced)
 *   docker compose exec backend php artisan diagrams:reingest --note=123
 *
 *   # every image/PDF note for a student
 *   docker compose exec backend php artisan diagrams:reingest --user=student@tuto.ai
 */
class DiagramsReingest extends Command
{
    protected $signature = 'diagrams:reingest
        {--note= : A single TopicNote id to re-ingest}
        {--user= : Re-ingest every image/PDF note for this student id or email}';

    protected $description = 'Regenerate isolated diagram assets + anchor text for existing notes';

    public function handle(NotesService $notes): int
    {
        $query = TopicNote::query()->whereIn('kind', ['image', 'pdf']);

        if ($noteId = $this->option('note')) {
            $query->whereKey((int) $noteId);
        } elseif ($user = $this->option('user')) {
            $userId = is_numeric($user)
                ? (int) $user
                : optional(\App\Models\User::where('email', $user)->first())->id;
            if (! $userId) {
                $this->error('Pass a valid --user=<id|email>.');
                return self::FAILURE;
            }
            $query->where('user_id', $userId);
        } else {
            $this->error('Pass --note=<id> or --user=<id|email>.');
            return self::FAILURE;
        }

        $targets = $query->get();
        if ($targets->isEmpty()) {
            $this->warn('No matching image/PDF notes found.');
            return self::SUCCESS;
        }

        $this->info("Re-ingesting diagrams for {$targets->count()} note(s)…");
        $total = 0;
        foreach ($targets as $note) {
            try {
                $count = $notes->reingestDiagrams($note);
                $total += $count;
                $this->line("  note #{$note->id} \"{$note->title}\" → {$count} diagram node(s)");
            } catch (\Throwable $e) {
                $this->warn("  note #{$note->id} failed: {$e->getMessage()}");
            }
        }

        $this->info("Done. {$total} diagram node(s) refreshed with isolated assets.");
        return self::SUCCESS;
    }
}
