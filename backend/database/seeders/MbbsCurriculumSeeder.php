<?php

namespace Database\Seeders;

use App\Models\Stage;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * MBBS First Year curriculum — added under the existing "Undergraduate" stage.
 *
 * IDEMPOTENT: every node is firstOrCreate'd on its natural key (slug within its
 * parent), so this is safe to run on a LIVE database and safe to re-run — it
 * never duplicates and never touches the rest of the curriculum. Extend the
 * tree() data and re-run to add Anatomy / Biochemistry or more topics later.
 *
 *   php artisan db:seed --class=MbbsCurriculumSeeder --force
 *   php artisan graph:sync                # mirror the new hierarchy into Neo4j
 *
 * After seeding, the MBBS student must be on the "MBBS — Year 1" level (pick it
 * in-app, or set user.level_id) for subject-scoped notes/figures to resolve.
 */
class MbbsCurriculumSeeder extends Seeder
{
    public function run(): void
    {
        // Reuse the existing Undergraduate stage if present; else create it.
        $stage = Stage::firstOrCreate(
            ['slug' => 'undergraduate'],
            ['name' => 'Undergraduate', 'emoji' => '🎓', 'blurb' => "Bachelor's degree programmes", 'position' => 2],
        );

        $track = $stage->tracks()->firstOrCreate(
            ['slug' => 'mbbs'],
            ['name' => 'MBBS', 'emoji' => '🩺', 'tint' => 'rose',
             'blurb' => 'Bachelor of Medicine and Bachelor of Surgery', 'position' => 99],
        );

        $level = $track->levels()->firstOrCreate(
            ['slug' => 'mbbs-year-1'],
            ['name' => 'MBBS — Year 1', 'stream' => null, 'class_number' => null, 'position' => 0],
        );

        foreach ($this->subjects() as $sj => [$name, $emoji, $tint, $blurb, $chapters]) {
            $subject = $level->subjects()->firstOrCreate(
                ['slug' => Str::slug($name)],
                ['name' => $name, 'emoji' => $emoji, 'tint' => $tint, 'blurb' => $blurb, 'position' => $sj],
            );

            foreach ($chapters as $ci => [$chapterName, $topics]) {
                $chapter = $subject->chapters()->firstOrCreate(
                    ['slug' => Str::slug($chapterName)],
                    ['name' => $chapterName, 'position' => $ci],
                );
                foreach ($topics as $tj => $topic) {
                    $chapter->topics()->firstOrCreate(
                        ['slug' => Str::slug($topic)],
                        ['name' => $topic, 'position' => $tj],
                    );
                }
            }
        }

        $this->command?->info('Seeded MBBS — Year 1 (Physiology). Run "php artisan graph:sync" next.');
    }

    /** [name, emoji, tint, blurb, chapters[[name, topics[]]]] */
    private function subjects(): array
    {
        return [
            ['Physiology', '🫀', 'rose', 'Functions of the human body — NMC CBME first-year syllabus', [
                ['General Physiology', [
                    'Cell & Cell Membrane', 'Transport Across Cell Membrane', 'Homeostasis & Feedback',
                    'Body Fluid Compartments', 'Resting Membrane Potential & Action Potential',
                ]],
                ['Blood (Hematology)', [
                    'Composition & Functions of Blood', 'Plasma Proteins', 'Erythropoiesis & Red Blood Cells',
                    'Hemoglobin & Anemia', 'White Blood Cells & Immunity', 'Platelets & Hemostasis',
                    'Blood Coagulation', 'Blood Groups & Transfusion',
                ]],
                ['Nerve & Muscle Physiology', [
                    'Structure & Properties of Neuron', 'Nerve Fibre Types & Conduction',
                    'Neuromuscular Junction', 'Skeletal Muscle Structure', 'Excitation–Contraction Coupling',
                    'Muscle Mechanics', 'Smooth & Cardiac Muscle Properties',
                ]],
                ['Gastrointestinal System', [
                    'Functional Anatomy & Enteric Nervous System', 'Mastication & Deglutition',
                    'GI Motility', 'Salivary Secretion', 'Gastric Secretion & Peptic Ulcer',
                    'Pancreatic Secretion', 'Bile Secretion & Functions of Liver', 'Gallbladder Function',
                    'Digestion & Absorption', 'Functional Anatomy of Intestinal Villi', 'GI Hormones',
                ]],
                ['Cardiovascular System', [
                    'Properties of Cardiac Muscle', 'Cardiac Cycle & Heart Sounds', 'Cardiac Output & Its Regulation',
                    'Electrocardiogram (ECG)', 'Blood Pressure & Its Regulation', 'Arterial Pulse & Venous Return',
                    'Regional Circulation', 'Cardiovascular Adjustments & Shock',
                ]],
                ['Respiratory System', [
                    'Mechanics of Respiration', 'Compliance & Surfactant', 'Lung Volumes & Capacities',
                    'Transport of Oxygen & Carbon Dioxide', 'Regulation of Respiration',
                    'Hypoxia, Cyanosis & Dyspnea', 'Pulmonary Function Tests',
                ]],
                ['Renal System', [
                    'Functional Anatomy of Kidney', 'Glomerular Filtration Rate', 'Tubular Reabsorption & Secretion',
                    'Counter-current Mechanism', 'Concentration & Dilution of Urine', 'Acid–Base Regulation by Kidney',
                    'Micturition', 'Renal Function Tests',
                ]],
                ['Endocrine System', [
                    'Introduction & Mechanism of Hormone Action', 'Hypothalamus & Pituitary Gland',
                    'Growth Hormone', 'Thyroid Gland & Its Disorders', 'Adrenal Cortex & Medulla',
                    'Endocrine Pancreas & Diabetes Mellitus', 'Parathyroid & Calcium Homeostasis',
                ]],
                ['Reproductive System', [
                    'Male Reproductive System & Spermatogenesis', 'Female Reproductive System & Oogenesis',
                    'Menstrual Cycle', 'Pregnancy & Placental Hormones', 'Lactation', 'Puberty & Menopause',
                ]],
                ['Nervous System', [
                    'Synaptic Transmission & Neurotransmitters', 'Sensory Receptors & Pathways', 'Pain & Its Modulation',
                    'Motor System & Descending Tracts', 'Reflexes', 'Spinal Cord & Brainstem',
                    'Cerebellum', 'Basal Ganglia', 'Posture & Equilibrium', 'Cerebral Cortex & EEG',
                    'Sleep & Wakefulness', 'Autonomic Nervous System', 'Learning, Memory & Limbic System',
                ]],
                ['Special Senses', [
                    'Physiology of Vision', 'Photoreceptors & Visual Pathway', 'Colour Vision & Errors of Refraction',
                    'Physiology of Hearing', 'Vestibular Apparatus & Equilibrium', 'Taste & Smell',
                ]],
                ['Integrative & Applied Physiology', [
                    'Regulation of Body Temperature', 'Exercise Physiology',
                    'High Altitude & Deep Sea Physiology', 'Physiology of Aging',
                ]],
            ]],
        ];
    }
}
