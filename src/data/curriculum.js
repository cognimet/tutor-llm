// Indian education system curriculum data for the AI Tutor MVP.
// Structure: Board -> Class -> Subject -> Chapter -> Topic
// Kept intentionally light for the MVP; extend as needed.

export const BOARDS = [
  { id: "cbse", name: "CBSE", full: "Central Board of Secondary Education", emoji: "📘", tint: "indigo" },
  { id: "icse", name: "ICSE", full: "Indian Certificate of Secondary Education", emoji: "📗", tint: "emerald" },
  { id: "state", name: "State Board", full: "Your State Board (e.g. Maharashtra, TN, UP)", emoji: "📙", tint: "amber" },
  { id: "ncert", name: "NCERT", full: "National Council of Educational Research", emoji: "📕", tint: "rose" },
];

export const CLASSES = [6, 7, 8, 9, 10, 11, 12];

export const LANGUAGES = [
  { id: "en", name: "English", native: "English" },
  { id: "hi", name: "Hindi", native: "हिन्दी" },
  { id: "hinglish", name: "Hinglish", native: "Hinglish" },
];

// Subjects with a representative chapter/topic tree. Topic = unit of AI chat.
export const SUBJECTS = [
  {
    id: "maths",
    name: "Mathematics",
    emoji: "📐",
    tint: "indigo",
    blurb: "Numbers, algebra, geometry & more",
    chapters: [
      {
        id: "real-numbers",
        name: "Real Numbers",
        topics: ["Euclid's Division Lemma", "Fundamental Theorem of Arithmetic", "Rational & Irrational Numbers"],
      },
      {
        id: "polynomials",
        name: "Polynomials",
        topics: ["Zeroes of a Polynomial", "Relationship between Zeroes & Coefficients", "Division Algorithm"],
      },
      {
        id: "linear-equations",
        name: "Pair of Linear Equations",
        topics: ["Graphical Method", "Substitution Method", "Elimination Method", "Cross-Multiplication"],
      },
      {
        id: "trigonometry",
        name: "Introduction to Trigonometry",
        topics: ["Trigonometric Ratios", "Trigonometric Identities", "Heights & Distances"],
      },
    ],
  },
  {
    id: "science",
    name: "Science",
    emoji: "🔬",
    tint: "emerald",
    blurb: "Physics, Chemistry & Biology",
    chapters: [
      {
        id: "light",
        name: "Light – Reflection & Refraction",
        topics: ["Laws of Reflection", "Spherical Mirrors", "Refraction of Light", "Lens Formula"],
      },
      {
        id: "acids-bases",
        name: "Acids, Bases & Salts",
        topics: ["pH Scale", "Neutralisation Reaction", "Properties of Acids & Bases"],
      },
      {
        id: "life-processes",
        name: "Life Processes",
        topics: ["Nutrition", "Respiration", "Transportation", "Excretion"],
      },
      {
        id: "electricity",
        name: "Electricity",
        topics: ["Ohm's Law", "Resistance & Resistivity", "Heating Effect of Current"],
      },
    ],
  },
  {
    id: "social",
    name: "Social Science",
    emoji: "🌏",
    tint: "amber",
    blurb: "History, Geography, Civics & Economics",
    chapters: [
      {
        id: "nationalism",
        name: "Nationalism in India",
        topics: ["The Non-Cooperation Movement", "Civil Disobedience", "The Sense of Collective Belonging"],
      },
      {
        id: "resources",
        name: "Resources & Development",
        topics: ["Types of Resources", "Land Degradation", "Soil Conservation"],
      },
      {
        id: "democracy",
        name: "Power Sharing",
        topics: ["Forms of Power Sharing", "Belgium & Sri Lanka", "Why Power Sharing"],
      },
    ],
  },
  {
    id: "english",
    name: "English",
    emoji: "✍️",
    tint: "sky",
    blurb: "Grammar, literature & writing",
    chapters: [
      {
        id: "grammar",
        name: "Grammar Essentials",
        topics: ["Tenses", "Subject–Verb Agreement", "Reported Speech", "Active & Passive Voice"],
      },
      {
        id: "writing",
        name: "Writing Skills",
        topics: ["Formal Letter", "Article Writing", "Story Writing"],
      },
    ],
  },
  {
    id: "hindi",
    name: "Hindi",
    emoji: "📜",
    tint: "rose",
    blurb: "व्याकरण, साहित्य और लेखन",
    chapters: [
      {
        id: "vyakaran",
        name: "व्याकरण",
        topics: ["संधि", "समास", "अलंकार", "रस"],
      },
    ],
  },
  {
    id: "cs",
    name: "Computer",
    emoji: "💻",
    tint: "violet",
    blurb: "Coding, logic & digital skills",
    chapters: [
      {
        id: "python-basics",
        name: "Python Basics",
        topics: ["Variables & Data Types", "Loops", "Functions", "Lists & Dictionaries"],
      },
    ],
  },
];

export function getSubject(id) {
  return SUBJECTS.find((s) => s.id === id);
}
