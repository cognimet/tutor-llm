"""Request/response contracts shared across endpoints.

Every AI response carries a `usage` block (token counts + model) so the
Laravel token-metering layer can record real cost on each call.
"""
from pydantic import BaseModel, Field


# ── Usage / metering ───────────────────────────────────────────────────
class Usage(BaseModel):
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    mock: bool = False


# ── Chat ───────────────────────────────────────────────────────────────
class ChatMessage(BaseModel):
    role: str  # "user" | "tutor"
    content: str


class StudentContext(BaseModel):
    name: str | None = None
    level: str | None = None           # e.g. "Class 10"
    learning_style: str | None = None  # visual | reading | mixed
    language: str = "English"
    memory: dict = Field(default_factory=dict)        # weak/strong topics, prefs
    concept_mastery: dict = Field(default_factory=dict)  # concept -> 0..1


class ChatTurnRequest(BaseModel):
    student: StudentContext = Field(default_factory=StudentContext)
    student_id: int | None = None   # personalises graph-aware retrieval
    subject: str
    chapter: str
    topic: str
    mode: str = "teach"  # teach | socratic | quiz | exam | eli10
    history: list[ChatMessage] = Field(default_factory=list)
    message: str
    attempt_no: int = 1


class ChatTurnResponse(BaseModel):
    reply: str
    concept_tags: list[str] = Field(default_factory=list)
    detected_misconception: str | None = None
    difficulty_delta: int = 0  # -1 easier, 0 same, +1 harder
    suggested_render: str = "text"  # text | canvas | quiz | flashcard | mindmap
    next_step: str | None = None
    usage: Usage


# ── Assessment ─────────────────────────────────────────────────────────
class AssessmentGenerateRequest(BaseModel):
    student: StudentContext = Field(default_factory=StudentContext)
    subject: str
    chapter: str
    topic: str
    count: int = 3


class Question(BaseModel):
    concept: str
    type: str = "mcq"
    stem: str
    options: list[str] = Field(default_factory=list)
    answer_key: str
    difficulty: str = "medium"


class AssessmentGenerateResponse(BaseModel):
    questions: list[Question]
    usage: Usage


class GradeItem(BaseModel):
    concept: str
    stem: str
    correct_answer: str
    student_answer: str
    type: str = "mcq"


class AssessmentGradeRequest(BaseModel):
    topic: str
    items: list[GradeItem]


class GradedItem(BaseModel):
    concept: str
    is_correct: bool
    partial_score: float = 0.0
    feedback: str = ""
    detected_misconception: str | None = None


class AssessmentGradeResponse(BaseModel):
    graded: list[GradedItem]
    usage: Usage


# ── Gap analysis ───────────────────────────────────────────────────────
class GapAnalyzeRequest(BaseModel):
    topic: str
    results: list[dict]  # [{concept, is_correct, student_answer, ...}]


class Gap(BaseModel):
    concept: str
    severity: str = "medium"  # low | medium | high
    misconception: str | None = None
    recommendation: str = ""


class GapAnalyzeResponse(BaseModel):
    gaps: list[Gap]
    summary: str = ""
    usage: Usage


# ── Study plan ─────────────────────────────────────────────────────────
class PlanBuildRequest(BaseModel):
    topic: str
    gaps: list[dict] = Field(default_factory=list)


class PlanItem(BaseModel):
    title: str
    detail: str = ""
    concept: str | None = None


class PlanBuildResponse(BaseModel):
    title: str = "Your next steps"
    items: list[PlanItem]
    usage: Usage


# ── Notes ingestion (multimodal) ───────────────────────────────────────
class NotesIngestRequest(BaseModel):
    student_id: int
    text: str  # already OCR'd text (Laravel/worker does OCR upload first)
    topic: str | None = None
    note_id: int | None = None   # when set, the note is chunked + indexed for RAG
    title: str | None = None
    # Scope for retrieval (subject/chapter/topic notes) + ★ primary weighting.
    subject_id: int | None = None
    chapter_id: int | None = None
    topic_id: int | None = None
    is_primary: bool = False


class NotesIngestResponse(BaseModel):
    summary: str
    flashcards: list[dict]  # [{front, back}]
    chunks_indexed: int = 0
    usage: Usage


# ── File text extraction (notes upload) ────────────────────────────────
class ExtractRequest(BaseModel):
    filename: str
    mime: str | None = None
    content_base64: str            # raw base64 (no data: prefix)
    languages: str = "eng+hin"     # tesseract languages for image files


class ExtractResponse(BaseModel):
    text: str
    kind: str = "text"             # pdf | doc | sheet | image | text
    meta: dict = Field(default_factory=dict)  # pages | sheets | chars ...
    usage: Usage


# ── Study scheduler (Day/Week/Month/Exam planner) ──────────────────────
class StudyScheduleRequest(BaseModel):
    topic: str
    horizon: str = "week"          # day | week | month | exam
    days_remaining: int | None = None   # to the exam (exam horizon)
    exam_date: str | None = None        # ISO date, for context only
    notes_summary: str = ""        # the student's uploaded notes (content, not just a gist)
    gaps: list[dict] = Field(default_factory=list)
    mastery: int = 0               # 0..100 composite mastery for the topic
    from_notes: bool = False       # build the plan STRICTLY from the student's own notes


class ScheduleTask(BaseModel):
    day_index: int = 0             # 0-based day offset within the horizon
    title: str
    detail: str = ""
    concept: str | None = None
    kind: str = "learn"            # learn | practice | revise | assess
    estimated_minutes: int = 20


class StudyScheduleResponse(BaseModel):
    title: str = "Your study plan"
    summary: str = ""
    tasks: list[ScheduleTask] = Field(default_factory=list)
    usage: Usage


# ── Smart Note Inspection (strict, schema-enforced) ────────────────────
class NoteInspectRequest(BaseModel):
    system: str
    user: str


class NoteInspectSchema(BaseModel):
    """Strict output schema so the LLM always returns these exact keys (the
    scoping fix: Gemini under generic JSON mode would otherwise invent keys like
    `curriculum`/`SCOPE`, breaking the Laravel mapping)."""
    detected_subject: str | None = Field(default=None, description="Matched Subject name from curriculum, or null if completely unrelated")
    detected_chapter: str | None = Field(default=None, description="Matched Chapter name from curriculum, or null if completely unrelated")
    detected_topic: str | None = Field(default=None, description="Specific Topic name from curriculum topics list, or null")
    confidence_score: float = Field(default=0.0, description="Overall confidence mapping score from 0.0 to 1.0")
    core_keywords: list[str] = Field(default_factory=list, description="Top 5 core scientific/scholastic keywords from the text")
    formula_count: int = Field(default=0, description="Count of mathematical or chemical formulas spotted in text")
    diagrams_found: bool = Field(default=False, description="Whether diagrams, figures (e.g. Fig 4.1), or illustrations are present")
    has_corrections: bool = Field(default=False, description="Whether the note contains conceptual mistakes, errors, or factual typos")
    corrections: list[dict] = Field(default_factory=list, description="Encouraging corrections. Each item has 'mistake' and 'correction'")
    flashcard_candidates: list[dict] = Field(default_factory=list, description="3 proposed flashcards. Each item has 'question' and 'answer'")
