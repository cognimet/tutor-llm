<?php

namespace App\Console\Commands;

use App\Models\ContentChunk;
use App\Models\Level;
use App\Models\Subject;
use App\Models\Topic;
use App\Services\AiClient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

/**
 * Generate vetted curriculum content for a subject's topics with the AI, store
 * it as content_chunks, and embed it into the Qdrant `curriculum` collection.
 *
 * Use this to give the tutor real, topic-aligned grounding for a subject that
 * was seeded as a hierarchy only (e.g. MBBS Year 1 Physiology) — separate from
 * a student's uploaded book (which lives in `documents`).
 *
 *   php artisan curriculum:generate-content --subject=Physiology --level=mbbs-year-1 --only-missing --index
 *
 * Idempotent with --only-missing (skips topics that already have AI content).
 * Per-topic try/catch + a small pause so a free-tier model isn't rate-limited.
 */
class GenerateCurriculumContent extends Command
{
    protected $signature = 'curriculum:generate-content
        {--subject= : Subject name to generate for (e.g. Physiology)}
        {--level= : Level slug to scope the subject (e.g. mbbs-year-1)}
        {--only-missing : Skip topics that already have AI-generated content}
        {--index : Run rag:index --pending afterwards to embed into Qdrant}
        {--pause=1.0 : Seconds to wait between topics (free-tier rate limits)}';

    protected $description = 'AI-generate curriculum content per topic and embed it into the Qdrant curriculum collection';

    private const SOURCE = 'AI-generated curriculum';

    public function handle(AiClient $ai): int
    {
        $subjectName = (string) $this->option('subject');
        if ($subjectName === '') {
            $this->error('Pass --subject=<name>, e.g. --subject=Physiology');
            return self::FAILURE;
        }

        $subject = $this->resolveSubject($subjectName, (string) $this->option('level'));
        if (! $subject) {
            $this->error("Subject \"{$subjectName}\"".($this->option('level') ? " in level ".$this->option('level') : '')." not found.");
            return self::FAILURE;
        }

        $topics = Topic::whereHas('chapter', fn ($q) => $q->where('subject_id', $subject->id))
            ->with('chapter')->orderBy('chapter_id')->orderBy('position')->get();
        if ($topics->isEmpty()) {
            $this->error('That subject has no topics yet — seed the curriculum first.');
            return self::FAILURE;
        }

        $onlyMissing = (bool) $this->option('only-missing');
        $pause = (float) $this->option('pause');
        $this->info("Generating content for {$topics->count()} topics in {$subject->name}…");
        $bar = $this->output->createProgressBar($topics->count());
        $bar->start();

        $made = 0;
        $skipped = 0;
        $failed = 0;
        foreach ($topics as $topic) {
            $bar->advance();

            if ($onlyMissing && ContentChunk::where('topic_id', $topic->id)
                    ->where('source_ref', self::SOURCE)->exists()) {
                $skipped++;
                continue;
            }

            try {
                $data = $this->generate($ai, $subject->name, $topic);
                $chunks = $this->toChunks($data, $subject->name, $topic);
                if (empty($chunks)) {
                    $failed++;
                    continue;
                }
                // Replace any prior AI content for this topic, then insert fresh.
                ContentChunk::where('topic_id', $topic->id)->where('source_ref', self::SOURCE)->delete();
                foreach ($chunks as $c) {
                    ContentChunk::create([
                        'topic_id'   => $topic->id,
                        'type'       => $c['type'],
                        'body'       => $c['body'],
                        'source_ref' => self::SOURCE,
                    ]);
                }
                $made++;
            } catch (\Throwable $e) {
                $failed++;
                $this->newLine();
                $this->warn("  {$topic->name}: {$e->getMessage()}");
            }

            if ($pause > 0) usleep((int) ($pause * 1_000_000));
        }

        $bar->finish();
        $this->newLine(2);
        $this->info("Done — {$made} topics written, {$skipped} skipped, {$failed} failed.");

        if ($this->option('index')) {
            $this->info('Embedding new content into Qdrant (rag:index --pending)…');
            Artisan::call('rag:index', ['--pending' => true], $this->output);
        } else {
            $this->line('Next: php artisan rag:index --pending   (embeds the new content into Qdrant)');
        }

        return self::SUCCESS;
    }

    /** Ask the structured model for exam-focused content on one topic. */
    private function generate(AiClient $ai, string $subjectName, Topic $topic): array
    {
        $chapter = $topic->chapter?->name ?? '';
        $system = "You are an expert medical physiology educator writing concise, factually accurate, "
            . "exam-focused curriculum notes for an MBBS first-year student in India (NMC CBME syllabus). "
            . "Be clinically relevant and precise. Do not invent facts. Output STRICT JSON only.";
        $user = "Subject: {$subjectName}\nChapter: {$chapter}\nTopic: {$topic->name}\n\n"
            . "Write curriculum content for this topic as JSON with exactly these keys:\n"
            . "{\n"
            . "  \"explainer\": \"2-4 short paragraphs explaining the topic clearly for a first-year MBBS student\",\n"
            . "  \"key_points\": [\"5-8 high-yield bullet facts a student must remember\"],\n"
            . "  \"example\": \"one applied or clinical example that makes the concept concrete\",\n"
            . "  \"common_mistakes\": \"the most common misconceptions or exam errors on this topic\"\n"
            . "}";

        return $ai->json($system, $user, [
            'explainer' => '', 'key_points' => [], 'example' => '', 'common_mistakes' => '',
        ], null, 'structured');
    }

    /** Turn the generated JSON into typed content_chunks. */
    private function toChunks(array $data, string $subjectName, Topic $topic): array
    {
        $out = [];
        $explainer = trim((string) ($data['explainer'] ?? ''));
        if ($explainer !== '') {
            $out[] = ['type' => 'explainer', 'body' => $explainer];
        }

        $points = is_array($data['key_points'] ?? null) ? array_filter(array_map('trim', $data['key_points'])) : [];
        if ($points) {
            $out[] = ['type' => 'explainer', 'body' => "Key points — {$topic->name}:\n- ".implode("\n- ", $points)];
        }

        $example = trim((string) ($data['example'] ?? ''));
        if ($example !== '') {
            $out[] = ['type' => 'example', 'body' => $example];
        }

        $mistakes = trim((string) ($data['common_mistakes'] ?? ''));
        if ($mistakes !== '') {
            $out[] = ['type' => 'misconception', 'body' => $mistakes];
        }

        return $out;
    }

    private function resolveSubject(string $name, string $levelSlug): ?Subject
    {
        $q = Subject::where('name', $name);
        if ($levelSlug !== '') {
            $levelId = Level::where('slug', $levelSlug)->value('id');
            if (! $levelId) return null;
            $q->where('level_id', $levelId);
        }
        return $q->orderBy('id')->first();
    }
}
