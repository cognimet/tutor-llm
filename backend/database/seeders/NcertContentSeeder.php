<?php

namespace Database\Seeders;

use App\Models\Chapter;
use App\Models\ContentChunk;
use App\Models\Level;
use App\Models\Subject;
use App\Models\Topic;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * Shared engine for seeding an NCERT textbook (extracted to JSON by the
 * scripts/extract_ncert_*.py tools) into the RAG knowledge base.
 *
 * Subclasses supply only the JSON file name and a source_ref prefix; the JSON
 * itself carries the board / class / subject it targets. Chapters and topics
 * are fuzzy-matched against the existing curriculum tree so book sections merge
 * into seeded topics where possible and are created only when missing.
 *
 * Idempotent: each run first deletes the chunks it previously inserted (matched
 * by the source_ref prefix), so re-seeding never duplicates.
 */
abstract class NcertContentSeeder extends Seeder
{
    /** e.g. 'seed-data/ncert_class10_science.json' (relative to database_path). */
    abstract protected function jsonFile(): string;

    /** Unique source_ref prefix, e.g. 'NCERT Class 10 Science'. */
    abstract protected function sourcePrefix(): string;

    public function run(): void
    {
        $path = database_path($this->jsonFile());
        if (! is_file($path)) {
            $this->command?->error("Missing {$path} — run the matching scripts/extract_ncert_*.py first.");

            return;
        }
        $data = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        $subject = $this->findSubject($data);
        if (! $subject) {
            $this->command?->error(sprintf(
                '%s %s %s subject not found — seed the curriculum first.',
                $data['board'] ?? ($data['level_slug'] ?? ''),
                isset($data['class_number']) ? 'Class '.$data['class_number'] : '',
                $data['subject'] ?? ''));

            return;
        }

        // Replace previously seeded chunks for THIS book instead of duplicating.
        // The pattern matches only this seeder's own source_ref format
        // ("<prefix>, Ch <section> (<file>.pdf p.N)") — note the space after
        // "Ch" and the "(<file>" marker — so it never clobbers the hand-written
        // ContentSeeder samples ("NCERT Class 10 Science, Ch. Electricity").
        $deleted = ContentChunk::where('source_ref', 'like', $this->sourcePrefix().', Ch %(%')->delete();
        if ($deleted) {
            $this->command?->warn("Removed {$deleted} previously seeded chunk(s) for {$this->sourcePrefix()}.");
        }

        // Snapshot the pre-existing tree once: book sections must only merge
        // into curriculum that existed before this run, never into topics
        // created by an earlier iteration of this same loop.
        $existingChapters = $subject->chapters()->get();

        $made = 0;
        foreach ($data['chapters'] as $chapterData) {
            $chapter = $this->matchByName($chapterData['name'], $existingChapters)
                ?? $subject->chapters()->create([
                    'name'     => $chapterData['name'],
                    'slug'     => Str::slug($chapterData['name']),
                    'position' => ((int) $subject->chapters()->max('position')) + 1,
                ]);
            $existingTopics = $chapter->topics()->get();

            foreach ($chapterData['topics'] as $topicData) {
                $topic = $this->matchByName($topicData['name'], $existingTopics)
                    ?? $chapter->topics()->create([
                        'name'     => $topicData['name'],
                        'slug'     => Str::slug($topicData['name']),
                        'position' => ((int) $chapter->topics()->max('position')) + 1,
                    ]);

                foreach ($topicData['chunks'] as $chunk) {
                    ContentChunk::create([
                        'topic_id'   => $topic->id,
                        'type'       => $chunk['type'],
                        'body'       => $chunk['body'],
                        'source_ref' => sprintf('%s, Ch %s (%s p.%d)',
                            $this->sourcePrefix(), $topicData['section'],
                            $chapterData['file'], $chunk['page']),
                    ]);
                    $made++;
                }
            }
        }

        $this->command?->info("Seeded {$made} {$this->sourcePrefix()} chunk(s). Now run: php artisan rag:index --pending");
    }

    /** Resolve Stage · <board> · Class <n> · <subject> from the JSON metadata.
     *  Overridable so non-board curricula (e.g. MBBS) can resolve differently. */
    protected function findSubject(array $data): ?Subject
    {
        $level = Level::whereHas('track', fn ($q) => $q->where('slug', Str::slug($data['board'])))
            ->where('class_number', $data['class_number'])
            ->first();

        return $level?->subjects()->where('name', $data['subject'])->first();
    }

    /**
     * Best fuzzy match by normalized name: exact, or one normalized name
     * contained in the other ("Zeroes & Coefficients" inside "Relationship
     * between Zeroes and Coefficients of a Polynomial"). When several
     * candidates hit, the longest (most specific) one wins.
     *
     * The contained side must be a MULTI-WORD phrase — otherwise a single
     * common word would wrongly merge whole chapters (e.g. Economics
     * "Development" must NOT fold into Geography "Resources & Development").
     * A bare single word only matches by exact equality.
     *
     * @template T of Chapter|Topic
     * @param  \Illuminate\Support\Collection<int, T>  $candidates
     * @return T|null
     */
    private function matchByName(string $wanted, $candidates)
    {
        $w = $this->normalize($wanted);
        $best = null;
        $bestLen = 0;
        $multiWord = fn (string $s) => str_contains($s, ' ');

        foreach ($candidates as $candidate) {
            $h = $this->normalize($candidate->name);
            if ($w === '' || $h === '') {
                continue;
            }
            $hit = $h === $w
                || (strlen($h) >= 8 && $multiWord($h) && str_contains($w, $h))
                || (strlen($w) >= 8 && $multiWord($w) && str_contains($h, $w));
            if ($hit && strlen($h) > $bestLen) {
                $best = $candidate;
                $bestLen = strlen($h);
            }
        }

        return $best;
    }

    /** Lowercase, strip punctuation and filler words, collapse whitespace. */
    private function normalize(string $s): string
    {
        $s = strtolower(trim(preg_replace('/[^a-z0-9 ]+/i', ' ', str_replace(['&', '–', '—'], ' ', $s))));
        $s = preg_replace('/\b(the|a|an|of|to|in|for|with|between|and|some)\b/', ' ', $s);

        return trim(preg_replace('/\s+/', ' ', $s));
    }
}
