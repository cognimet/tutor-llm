<?php

namespace Database\Seeders;

use App\Models\Stage;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * Seeds a broad, representative slice of the Indian education system across
 * every stage — School, Coaching, Undergraduate, Postgraduate — so the
 * structure is visibly "whole". Admins extend it freely from the console.
 *
 * Shape per entry:
 *   stage  => [name, emoji, blurb]
 *   tracks => [ [name, slug, emoji, tint, blurb], levels => [...] ]
 *   level  => [name, stream|null, class_number|null, subjects[]]
 *   subject=> [name, emoji, tint, blurb, chapters[]]
 *   chapter=> [name, [topic, topic, ...]]
 */
class CurriculumSeeder extends Seeder
{
    public function run(): void
    {
        foreach ($this->tree() as $si => $stageData) {
            $stage = Stage::create([
                'name'     => $stageData['stage'][0],
                'slug'     => Str::slug($stageData['stage'][0]),
                'emoji'    => $stageData['stage'][1],
                'blurb'    => $stageData['stage'][2],
                'position' => $si,
            ]);

            foreach ($stageData['tracks'] as $ti => $trackData) {
                $track = $stage->tracks()->create([
                    'name'     => $trackData['track'][0],
                    'slug'     => $trackData['track'][1],
                    'emoji'    => $trackData['track'][2],
                    'tint'     => $trackData['track'][3],
                    'blurb'    => $trackData['track'][4],
                    'position' => $ti,
                ]);

                foreach ($trackData['levels'] as $li => $levelData) {
                    [$levelName, $stream, $classNo, $subjects] = $levelData;

                    $level = $track->levels()->create([
                        'name'         => $levelName,
                        'slug'         => Str::slug($levelName),
                        'stream'       => $stream,
                        'class_number' => $classNo,
                        'position'     => $li,
                    ]);

                    foreach ($subjects as $sj => [$name, $emoji, $tint, $blurb, $chapters]) {
                        $subject = $level->subjects()->create([
                            'name'     => $name,
                            'slug'     => Str::slug($name),
                            'emoji'    => $emoji,
                            'tint'     => $tint,
                            'blurb'    => $blurb,
                            'position' => $sj,
                        ]);

                        foreach ($chapters as $ci => [$chapterName, $topics]) {
                            $chapter = $subject->chapters()->create([
                                'name'     => $chapterName,
                                'slug'     => Str::slug($chapterName),
                                'position' => $ci,
                            ]);
                            foreach ($topics as $tj => $topic) {
                                $chapter->topics()->create([
                                    'name'     => $topic,
                                    'slug'     => Str::slug($topic),
                                    'position' => $tj,
                                ]);
                            }
                        }
                    }
                }
            }
        }
    }

    /** Compact, readable definition of the whole tree. */
    private function tree(): array
    {
        // Shorthand builders to keep the data dense and legible.
        $sub = fn ($name, $emoji, $tint, $blurb, $chapters = []) => [$name, $emoji, $tint, $blurb, $chapters];
        $lite = fn ($name, $emoji, $tint, $blurb, array $chapters) => $sub($name, $emoji, $tint, $blurb, $chapters);

        return [
            /* ================================================== SCHOOL */
            [
                'stage' => ['School', '🏫', 'Primary to senior secondary (Classes 1–12)'],
                'tracks' => [
                    [
                        'track' => ['CBSE', 'cbse', '📘', 'indigo', 'Central Board of Secondary Education'],
                        'levels' => [
                            ['Class 6', null, 6, [
                                $sub('Mathematics', '📐', 'indigo', 'Ganita Prakash — patterns, numbers, geometry & more', [
                                    ['Patterns in Mathematics', []],
                                    ['Lines and Angles', []],
                                    ['Number Play', []],
                                    ['Data Handling and Presentation', []],
                                    ['Prime Time', []],
                                    ['Perimeter and Area', []],
                                    ['Fractions', []],
                                    ['Playing with Constructions', []],
                                    ['Symmetry', []],
                                    ['The Other Side of Zero', []],
                                ]),
                                $sub('Science', '🔬', 'emerald', 'Curiosity — living world, materials, motion, magnets & the sky', [
                                    ['The Wonderful World of Science', []],
                                    ['Diversity in the Living World', []],
                                    ['Mindful Eating: A Path to a Healthy Body', []],
                                    ['Exploring Magnets', []],
                                    ['Measurement of Length and Motion', []],
                                    ['Materials Around Us', []],
                                    ['Temperature and its Measurement', []],
                                    ['A Journey through States of Water', []],
                                    ['Methods of Separation in Everyday Life', []],
                                    ['Living Creatures: Exploring their Characteristics', []],
                                    ["Nature's Treasures", []],
                                    ['Beyond Earth', []],
                                ]),
                            ]],
                            ['Class 8', null, 8, [
                                $lite('Mathematics', '📐', 'indigo', 'Rational numbers, mensuration & algebra', [
                                    ['Rational Numbers', ['Properties', 'Operations', 'On the Number Line']],
                                    ['Mensuration', ['Area of Trapezium', 'Surface Area', 'Volume of Cuboid']],
                                ]),
                                $lite('Science', '🔬', 'emerald', 'Force, sound, cells & more', [
                                    ['Force and Pressure', ['Types of Forces', 'Pressure', 'Atmospheric Pressure']],
                                    ['Cell — Structure & Functions', ['Discovery of Cell', 'Cell Organelles']],
                                ]),
                                $lite('Social Science', '🌏', 'amber', 'History, geography & civics', [
                                    ['The Indian Constitution', ['Why a Constitution', 'Key Features']],
                                ]),
                            ]],
                            ['Class 9', null, 9, [
                                $lite('Mathematics', '📐', 'indigo', 'Number systems, polynomials & geometry', [
                                    ['Number Systems', ['Irrational Numbers', 'Real Numbers & Decimals', 'Laws of Exponents']],
                                    ['Polynomials', ['Degree of a Polynomial', 'Remainder Theorem', 'Factorisation']],
                                ]),
                                $lite('Science', '🔬', 'emerald', 'Matter, motion & living world', [
                                    ['Matter in Our Surroundings', ['States of Matter', 'Evaporation', 'Latent Heat']],
                                    ['Motion', ['Distance & Displacement', 'Velocity & Acceleration', 'Equations of Motion']],
                                ]),
                            ]],
                            ['Class 10', null, 10, [
                                $sub('Mathematics', '📐', 'indigo', 'Numbers, algebra, geometry & more', [
                                    ['Real Numbers', ["Euclid's Division Lemma", 'Fundamental Theorem of Arithmetic', 'Rational & Irrational Numbers']],
                                    ['Polynomials', ['Zeroes of a Polynomial', 'Zeroes & Coefficients', 'Division Algorithm']],
                                    ['Pair of Linear Equations', ['Graphical Method', 'Substitution Method', 'Elimination Method']],
                                    ['Introduction to Trigonometry', ['Trigonometric Ratios', 'Trigonometric Identities', 'Heights & Distances']],
                                ]),
                                $sub('Science', '🔬', 'emerald', 'Physics, Chemistry & Biology', [
                                    ['Light – Reflection & Refraction', ['Laws of Reflection', 'Spherical Mirrors', 'Refraction of Light', 'Lens Formula']],
                                    ['Acids, Bases & Salts', ['pH Scale', 'Neutralisation Reaction', 'Properties of Acids & Bases']],
                                    ['Life Processes', ['Nutrition', 'Respiration', 'Transportation', 'Excretion']],
                                    ['Electricity', ["Ohm's Law", 'Resistance & Resistivity', 'Heating Effect of Current']],
                                ]),
                                $sub('Social Science', '🌏', 'amber', 'History, Geography, Civics & Economics', [
                                    ['Nationalism in India', ['Non-Cooperation Movement', 'Civil Disobedience', 'Collective Belonging']],
                                    ['Resources & Development', ['Types of Resources', 'Land Degradation', 'Soil Conservation']],
                                    ['Power Sharing', ['Forms of Power Sharing', 'Belgium & Sri Lanka', 'Why Power Sharing']],
                                ]),
                                $sub('English', '✍️', 'sky', 'Grammar, literature & writing', [
                                    ['Grammar Essentials', ['Tenses', 'Subject–Verb Agreement', 'Reported Speech', 'Active & Passive Voice']],
                                    ['Writing Skills', ['Formal Letter', 'Article Writing', 'Story Writing']],
                                ]),
                                $sub('Hindi', '📜', 'rose', 'व्याकरण, साहित्य और लेखन', [
                                    ['व्याकरण', ['संधि', 'समास', 'अलंकार', 'रस']],
                                ]),
                                $sub('Computer', '💻', 'violet', 'Coding, logic & digital skills', [
                                    ['Python Basics', ['Variables & Data Types', 'Loops', 'Functions', 'Lists & Dictionaries']],
                                ]),
                            ]],
                            ['Class 11 – Science', 'science', 11, [
                                $lite('Physics', '🧲', 'sky', 'Mechanics, thermodynamics & waves', [
                                    ['Units & Measurements', ['SI Units', 'Significant Figures', 'Dimensional Analysis']],
                                    ['Laws of Motion', ["Newton's Laws", 'Friction', 'Circular Motion']],
                                ]),
                                $lite('Chemistry', '⚗️', 'emerald', 'Atomic structure & bonding', [
                                    ['Structure of Atom', ['Bohr Model', 'Quantum Numbers', 'Electronic Configuration']],
                                    ['Chemical Bonding', ['Ionic Bond', 'Covalent Bond', 'VSEPR Theory']],
                                ]),
                                $lite('Mathematics', '📐', 'indigo', 'Sets, trigonometry & calculus basics', [
                                    ['Sets', ['Types of Sets', 'Venn Diagrams', 'Operations on Sets']],
                                    ['Trigonometric Functions', ['Radian Measure', 'Identities', 'General Solutions']],
                                ]),
                                $lite('Biology', '🧬', 'rose', 'Diversity & cell biology', [
                                    ['The Living World', ['Taxonomy', 'Classification', 'Nomenclature']],
                                    ['Cell — The Unit of Life', ['Cell Theory', 'Organelles', 'Cell Cycle']],
                                ]),
                            ]],
                            ['Class 11 – Commerce', 'commerce', 11, [
                                $lite('Accountancy', '🧾', 'amber', 'Recording & summarising transactions', [
                                    ['Introduction to Accounting', ['Need for Accounting', 'Basic Terms', 'Accounting Equation']],
                                    ['Journal & Ledger', ['Double Entry', 'Journal Entries', 'Posting to Ledger']],
                                ]),
                                $lite('Business Studies', '🏢', 'indigo', 'Business, trade & enterprise', [
                                    ['Nature & Purpose of Business', ['Business Activities', 'Profession vs Employment']],
                                ]),
                                $lite('Economics', '📊', 'emerald', 'Micro & statistics for economics', [
                                    ['Introduction to Microeconomics', ['Central Problems', 'Opportunity Cost', 'PPC']],
                                ]),
                            ]],
                            ['Class 12 – Science', 'science', 12, [
                                $lite('Physics', '🧲', 'sky', 'Electrostatics, optics & modern physics', [
                                    ['Electrostatics', ["Coulomb's Law", 'Electric Field', 'Gauss Law']],
                                    ['Current Electricity', ['Drift Velocity', 'Kirchhoff Laws', 'Wheatstone Bridge']],
                                ]),
                                $lite('Chemistry', '⚗️', 'emerald', 'Solutions, electrochemistry & organic', [
                                    ['Solutions', ['Concentration Terms', "Raoult's Law", 'Colligative Properties']],
                                    ['Electrochemistry', ['Electrochemical Cells', 'Nernst Equation', 'Conductance']],
                                ]),
                                $lite('Mathematics', '📐', 'indigo', 'Calculus, vectors & probability', [
                                    ['Relations & Functions', ['Types of Relations', 'Composition', 'Invertible Functions']],
                                    ['Integrals', ['Indefinite Integrals', 'Definite Integrals', 'Applications']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['ICSE', 'icse', '📗', 'emerald', 'Council for the Indian School Certificate'],
                        'levels' => [
                            ['Class 10', null, 10, [
                                $lite('Mathematics', '📐', 'indigo', 'Commercial maths, geometry & trig', [
                                    ['GST & Banking', ['GST Computation', 'Recurring Deposits']],
                                    ['Quadratic Equations', ['Solving by Factorisation', 'Quadratic Formula', 'Nature of Roots']],
                                ]),
                                $lite('Physics', '🧲', 'sky', 'Force, light & electricity', [
                                    ['Force, Work, Power & Energy', ['Moments', 'Work & Power', 'Machines']],
                                ]),
                                $lite('English Literature', '📖', 'rose', 'Prose, poetry & drama', [
                                    ['Drama — The Merchant of Venice', ['Act Summaries', 'Character Sketches', 'Themes']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['State Board', 'state', '🏛️', 'amber', 'State-level secondary boards'],
                        'levels' => [
                            ['Class 10', null, 10, [
                                $lite('Mathematics', '📐', 'indigo', 'Algebra & geometry', [
                                    ['Arithmetic Progression', ['nth Term', 'Sum of n Terms', 'Word Problems']],
                                ]),
                                $lite('Science', '🔬', 'emerald', 'Physics, chemistry & biology', [
                                    ['Chemical Reactions', ['Types of Reactions', 'Balancing Equations']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['NCERT', 'ncert', '📕', 'rose', 'NCERT core syllabus'],
                        'levels' => [
                            ['Class 12 – Science', 'science', 12, [
                                $lite('Biology', '🧬', 'rose', 'Genetics, evolution & biotech', [
                                    ['Principles of Inheritance', ["Mendel's Laws", 'Linkage', 'Sex Determination']],
                                    ['Molecular Basis of Inheritance', ['DNA Structure', 'Replication', 'Transcription']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['IB', 'ib', '🌐', 'violet', 'International Baccalaureate'],
                        'levels' => [
                            ['DP Year 1', null, 11, [
                                $lite('Mathematics AA', '📐', 'indigo', 'Analysis & approaches', [
                                    ['Number & Algebra', ['Sequences & Series', 'Exponents & Logs', 'Binomial Theorem']],
                                ]),
                                $lite('Physics HL', '🧲', 'sky', 'Higher level physics', [
                                    ['Measurements & Uncertainties', ['SI Units', 'Uncertainty', 'Vectors']],
                                ]),
                            ]],
                        ],
                    ],
                ],
            ],

            /* ================================================ COACHING */
            [
                'stage' => ['Coaching & Competitive', '🎯', 'Entrance & competitive exam preparation'],
                'tracks' => [
                    [
                        'track' => ['JEE (Main + Advanced)', 'jee', '🛠️', 'indigo', 'Engineering entrance'],
                        'levels' => [
                            ['Class 11 Foundation', null, 11, [
                                $lite('Physics', '🧲', 'sky', 'Mechanics & thermodynamics', [
                                    ['Kinematics', ['Motion in 1D', 'Projectile Motion', 'Relative Velocity']],
                                    ['Rotational Motion', ['Torque', 'Moment of Inertia', 'Angular Momentum']],
                                ]),
                                $lite('Chemistry', '⚗️', 'emerald', 'Physical & organic basics', [
                                    ['Mole Concept', ['Stoichiometry', 'Limiting Reagent', 'Empirical Formula']],
                                ]),
                                $lite('Mathematics', '📐', 'indigo', 'Algebra & calculus', [
                                    ['Quadratic Equations', ['Nature of Roots', 'Common Roots', 'Range of Functions']],
                                    ['Limits & Derivatives', ['Limits', 'Differentiation Rules', 'Tangents & Normals']],
                                ]),
                            ]],
                            ['Class 12 / Dropper', null, 12, [
                                $lite('Physics', '🧲', 'sky', 'Electrodynamics & modern physics', [
                                    ['Electrostatics', ['Field & Potential', 'Capacitance', 'Dielectrics']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['NEET', 'neet', '🩺', 'rose', 'Medical entrance'],
                        'levels' => [
                            ['Class 11 Foundation', null, 11, [
                                $lite('Biology', '🧬', 'rose', 'Botany & zoology', [
                                    ['Cell Biology', ['Cell Structure', 'Biomolecules', 'Cell Division']],
                                    ['Human Physiology', ['Digestion', 'Breathing', 'Circulation']],
                                ]),
                                $lite('Chemistry', '⚗️', 'emerald', 'Physical, inorganic & organic', [
                                    ['Some Basic Concepts', ['Mole Concept', 'Concentration Terms']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['UPSC Civil Services', 'upsc', '🏛️', 'amber', 'IAS / IPS / IFS preparation'],
                        'levels' => [
                            ['Prelims', null, null, [
                                $lite('General Studies', '🌐', 'indigo', 'Polity, history, geography & current affairs', [
                                    ['Indian Polity', ['Constitution', 'Fundamental Rights', 'Parliament']],
                                    ['Modern History', ['Revolt of 1857', 'Freedom Movement', 'Post-Independence']],
                                ]),
                                $lite('CSAT', '🧮', 'emerald', 'Aptitude & reasoning', [
                                    ['Quantitative Aptitude', ['Number System', 'Percentages', 'Time & Work']],
                                ]),
                            ]],
                            ['Mains', null, null, [
                                $lite('Essay & Ethics', '✍️', 'rose', 'GS-IV & essay paper', [
                                    ['Ethics (GS-IV)', ['Aptitude & Foundational Values', 'Emotional Intelligence', 'Case Studies']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['CAT (MBA Entrance)', 'cat', '📈', 'violet', 'Management entrance'],
                        'levels' => [
                            ['Foundation', null, null, [
                                $lite('Quantitative Aptitude', '🧮', 'indigo', 'Arithmetic, algebra & geometry', [
                                    ['Arithmetic', ['Ratios & Proportions', 'Profit & Loss', 'Time, Speed & Distance']],
                                ]),
                                $lite('VARC', '📖', 'sky', 'Verbal ability & reading comprehension', [
                                    ['Reading Comprehension', ['Inference Questions', 'Tone & Style', 'Para Summary']],
                                ]),
                                $lite('DILR', '🧩', 'amber', 'Data interpretation & logical reasoning', [
                                    ['Logical Reasoning', ['Arrangements', 'Puzzles', 'Games & Tournaments']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['GATE', 'gate', '🎚️', 'emerald', 'Graduate aptitude test in engineering'],
                        'levels' => [
                            ['Computer Science', null, null, [
                                $lite('Algorithms', '🧠', 'indigo', 'Design & analysis of algorithms', [
                                    ['Complexity & Sorting', ['Asymptotic Notation', 'Divide & Conquer', 'Greedy']],
                                ]),
                                $lite('Operating Systems', '🖥️', 'sky', 'Processes, memory & files', [
                                    ['Process Management', ['Scheduling', 'Synchronisation', 'Deadlocks']],
                                ]),
                            ]],
                        ],
                    ],
                ],
            ],

            /* =========================================== UNDERGRADUATE */
            [
                'stage' => ['Undergraduate', '🎓', "Bachelor's degree programmes"],
                'tracks' => [
                    [
                        'track' => ['B.Tech — Computer Science', 'btech-cse', '💻', 'indigo', 'Engineering in CSE'],
                        'levels' => [
                            ['Semester 1', null, null, [
                                $lite('Programming in C', '💻', 'indigo', 'Fundamentals of programming', [
                                    ['Basics of C', ['Data Types', 'Operators', 'Control Flow']],
                                    ['Functions & Arrays', ['Function Calls', 'Recursion', 'Arrays & Strings']],
                                ]),
                                $lite('Engineering Mathematics I', '📐', 'sky', 'Calculus & linear algebra', [
                                    ['Matrices', ['Rank', 'Eigenvalues', 'Cayley–Hamilton']],
                                ]),
                            ]],
                            ['Semester 3', null, null, [
                                $lite('Data Structures', '🌲', 'emerald', 'Linear & non-linear structures', [
                                    ['Linear Structures', ['Stacks', 'Queues', 'Linked Lists']],
                                    ['Trees & Graphs', ['Binary Trees', 'BST', 'Graph Traversal']],
                                ]),
                                $lite('DBMS', '🗄️', 'amber', 'Relational databases', [
                                    ['Relational Model', ['Keys', 'Normalisation', 'Relational Algebra']],
                                    ['SQL', ['DDL & DML', 'Joins', 'Subqueries']],
                                ]),
                                $lite('Operating Systems', '🖥️', 'violet', 'Processes & memory', [
                                    ['Process Management', ['Scheduling Algorithms', 'Semaphores', 'Deadlock']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['B.Com', 'bcom', '🧾', 'amber', 'Bachelor of Commerce'],
                        'levels' => [
                            ['Year 1', null, null, [
                                $lite('Financial Accounting', '📒', 'indigo', 'Recording & reporting', [
                                    ['Accounting Process', ['Journal', 'Ledger', 'Trial Balance']],
                                    ['Final Accounts', ['Trading Account', 'P&L Account', 'Balance Sheet']],
                                ]),
                                $lite('Business Law', '⚖️', 'rose', 'Contracts & companies', [
                                    ['Indian Contract Act', ['Essentials of a Contract', 'Offer & Acceptance', 'Breach']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['B.Sc — Physics', 'bsc-physics', '🔭', 'sky', 'Bachelor of Science (Physics)'],
                        'levels' => [
                            ['Year 1', null, null, [
                                $lite('Mechanics', '🧲', 'sky', 'Classical mechanics', [
                                    ['Newtonian Mechanics', ['Frames of Reference', 'Work–Energy Theorem', 'Conservation Laws']],
                                ]),
                                $lite('Electricity & Magnetism', '⚡', 'amber', 'Fields & circuits', [
                                    ['Electrostatics', ["Gauss's Law", 'Potential', 'Capacitors']],
                                ]),
                            ]],
                        ],
                    ],
                ],
            ],

            /* ============================================ POSTGRADUATE */
            [
                'stage' => ['Postgraduate', '📚', "Master's degree programmes"],
                'tracks' => [
                    [
                        'track' => ['MBA', 'mba', '📈', 'indigo', 'Master of Business Administration'],
                        'levels' => [
                            ['Semester 1', null, null, [
                                $lite('Marketing Management', '📣', 'rose', 'Markets & consumers', [
                                    ['Marketing Fundamentals', ['Marketing Mix (4Ps)', 'Segmentation, Targeting, Positioning', 'Consumer Behaviour']],
                                ]),
                                $lite('Financial Management', '💰', 'emerald', 'Corporate finance', [
                                    ['Time Value of Money', ['Present & Future Value', 'Annuities', 'Capital Budgeting']],
                                ]),
                                $lite('Organisational Behaviour', '🧑‍🤝‍🧑', 'amber', 'People in organisations', [
                                    ['Foundations of OB', ['Personality', 'Motivation Theories', 'Group Dynamics']],
                                ]),
                            ]],
                        ],
                    ],
                    [
                        'track' => ['M.Tech — Computer Science', 'mtech-cse', '🧠', 'violet', 'Advanced CS specialisation'],
                        'levels' => [
                            ['Semester 1', null, null, [
                                $lite('Advanced Algorithms', '🧠', 'indigo', 'Beyond the basics', [
                                    ['Advanced Design', ['Amortised Analysis', 'Randomised Algorithms', 'Approximation Algorithms']],
                                ]),
                                $lite('Machine Learning', '🤖', 'sky', 'Statistical learning', [
                                    ['Supervised Learning', ['Linear Regression', 'Logistic Regression', 'SVM']],
                                ]),
                            ]],
                        ],
                    ],
                ],
            ],
        ];
    }
}
