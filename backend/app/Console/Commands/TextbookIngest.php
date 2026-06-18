<?php

namespace App\Console\Commands;

use App\Models\Subject;
use App\Models\TopicNote;
use App\Models\User;
use App\Services\AiClient;
use App\Services\CurriculumResolver;
use Illuminate\Console\Command;

/**
 * Seed a large textbook PDF (e.g. an 800-page MBBS Physiology book full of
 * hand-drawn diagrams) into the GraphRAG "AI mind". The AI service rasterises
 * every page, reads it with the vision model, and embeds each diagram as a
 * retrievable FIGURE the tutor teaches from and the UI can display.
 *
 * Avoids the browser's PHP upload limits (these books run 100-300 MB). Drop the
 * file onto the backend container's shared storage first, then run this:
 *
 *   docker compose cp "/host/path/Physiology.pdf" backend:/app/storage/app/textbooks/physiology.pdf
 *   docker compose exec backend php artisan textbook:ingest \
 *       --file=textbooks/physiology.pdf --subject=Physiology --user=student@tuto.ai
 *
 * Resumable: re-run the same command to continue an interrupted ingest.
 */
class TextbookIngest extends Command
{
    protected $signature = 'textbook:ingest
        {--file= : Path to the PDF, relative to storage/app (or absolute under it)}
        {--subject= : Subject name in the student\'s curriculum (e.g. Physiology)}
        {--user= : Student id or email the book belongs to}
        {--title= : Optional display title for the note}
        {--primary : Mark as exam-critical (ranked first in retrieval)}
        {--watch : Poll and print progress until the ingest finishes}';

    protected $description = 'Ingest a textbook PDF: render pages, read diagrams with the vision model, embed as figures';

    public function handle(AiClient $ai, CurriculumResolver $resolver): int
    {
        $file = (string) $this->option('file');
        if ($file === '') {
            $this->error('Pass --file=<path under storage/app>.');
            return self::FAILURE;
        }
        // Anchor to storage_path('app') — the SAME path the AI service mounts as
        // UPLOAD_ROOT (the shared volume root), so a file copied to
        // /app/storage/app/textbooks/... is found by both sides.
        $root = rtrim(storage_path('app'), '/').'/';
        $rel = str_starts_with($file, $root) ? ltrim(substr($file, strlen($root)), '/') : ltrim($file, '/');
        $abs = $root.$rel;
        if (! is_file($abs)) {
            $this->error("File not found on the shared volume: storage/app/{$rel}");
            $this->line('Copy it in first, e.g.:  docker compose cp "<host pdf>" backend:/app/storage/app/'.$rel);
            return self::FAILURE;
        }

        $user = $this->resolveUser((string) $this->option('user'));
        if (! $user) {
            $this->error('Pass a valid --user=<id|email>.');
            return self::FAILURE;
        }

        $subjectName = (string) $this->option('subject') ?: null;
        $subjectId = $resolver->subjectId($user, null, $subjectName);
        if ($subjectName && ! $subjectId) {
            $this->warn("Subject \"{$subjectName}\" not found in this student's curriculum — ingesting without a subject scope.");
        }

        $size = (int) filesize($abs);
        $note = TopicNote::create([
            'user_id'           => $user->id,
            'scope'             => 'subject',
            'subject_id'        => $subjectId,
            'subject_name'      => $subjectName ?: ($subjectId ? Subject::find($subjectId)?->name : null),
            'is_primary'        => (bool) $this->option('primary'),
            'title'             => $this->option('title') ?: ('Textbook: '.basename($rel)),
            'original_filename' => basename($rel),
            'mime'              => 'application/pdf',
            'kind'              => 'textbook',
            'size_bytes'        => $size,
            'disk'              => 'local',
            'path'              => $rel,
            'status'            => 'processing',
            'meta'              => ['textbook' => true],
        ]);

        $this->info("Created note #{$note->id} for {$user->email} — starting ingest of storage/app/{$rel} ({$this->human($size)})…");

        $start = $ai->startTextbookIngest($note->id, $rel, $user->id, [
            'subject_id' => $subjectId,
            'subject'    => $note->subject_name,
            'is_primary' => $note->is_primary,
        ]);
        if (($start['state'] ?? '') === 'failed') {
            $this->error('AI service could not start: '.($start['error'] ?? 'unknown error'));
            $note->update(['status' => 'failed', 'meta' => array_merge($note->meta ?? [], ['error' => $start['error'] ?? 'ingest start failed'])]);
            return self::FAILURE;
        }

        $this->line("Ingest started. The vision model reads one page at a time, so an 800-page book takes a while.");
        $this->line("Track progress:  php artisan textbook:ingest --watch  (or GET /api/tutor/textbooks/{$note->id}/status)");

        if ($this->option('watch')) {
            return $this->watch($ai, $note);
        }

        $note->update(['meta' => array_merge($note->meta ?? [], ['ingest_started_at' => now()->toIso8601String()])]);
        return self::SUCCESS;
    }

    /** Poll the AI service until the ingest is done, mirroring progress to the note. */
    protected function watch(AiClient $ai, TopicNote $note): int
    {
        $bar = null;
        while (true) {
            $st = $ai->textbookIngestStatus($note->id);
            $state = $st['state'] ?? 'unknown';
            $total = (int) ($st['total'] ?? 0);
            $done = (int) ($st['done'] ?? 0);

            if ($total > 0 && ! $bar) {
                $bar = $this->output->createProgressBar($total);
                $bar->start();
            }
            if ($bar) {
                $bar->setProgress(min($done, $total));
            }

            if (in_array($state, ['done', 'failed', 'cancelled'], true)) {
                if ($bar) { $bar->finish(); $this->newLine(); }
                $note->update([
                    'status' => $state === 'done' ? 'ready' : 'failed',
                    'meta'   => array_merge($note->meta ?? [], [
                        'figures' => (int) ($st['figures'] ?? 0),
                        'pages'   => $total,
                        'blank'   => (int) ($st['blank'] ?? 0),
                        'failed_pages' => (int) ($st['failed'] ?? 0),
                        'ingest_state' => $state,
                    ]),
                ]);
                $this->info("Ingest {$state}: ".($st['figures'] ?? 0)." figures from {$total} pages "
                    ."(blank: ".($st['blank'] ?? 0).", failed: ".($st['failed'] ?? 0).").");
                return $state === 'done' ? self::SUCCESS : self::FAILURE;
            }

            sleep(5);
        }
    }

    protected function resolveUser(string $idOrEmail): ?User
    {
        if ($idOrEmail === '') return null;
        return is_numeric($idOrEmail)
            ? User::find((int) $idOrEmail)
            : User::where('email', $idOrEmail)->first();
    }

    protected function human(int $bytes): string
    {
        $u = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        $n = (float) $bytes;
        while ($n >= 1024 && $i < count($u) - 1) { $n /= 1024; $i++; }
        return round($n, 1).' '.$u[$i];
    }
}
