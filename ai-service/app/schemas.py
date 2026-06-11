"""Request/response contracts for the internal Laravel -> AI service API.

Mirrors PART H of AI_Tutor_MASTER_PROMPT.md. Every response carries `usage`
(real prompt/completion tokens + model) so Laravel can meter cost
(AI_Tutor_Token_Management.md §3.2).
"""
from typing import Any, Optional

from pydantic import BaseModel, Field


class Usage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    model: str = ""


class StudentContext(BaseModel):
    """Everything the tutor knows about the student (memory + mastery)."""
    name: str = "Student"
    curriculum_path: Optional[str] = None   # "School · CBSE · Class 10 · Science"
    board: Optional[str] = None
    grade: Optional[str] = None
    language: str = "en"                    # en | hi | hinglish
    memory: dict[str, Any] = Field(default_factory=dict)        # student_memory key/values
    concept_mastery: list[dict] = Field(default_factory=list)   # [{concept, score, confidence}]
    open_misconceptions: list[str] = Field(default_factory=list)


class HistoryMessage(BaseModel):
    role: str       # user | tutor
    content: str


class ChatTurnRequest(BaseModel):
    student: StudentContext = Field(default_factory=StudentContext)
    topic: str
    chapter: str = ""
    subject: str = ""
    mode: str = "teach"      # teach | socratic | quiz | exam | eli10 | answer
    attempt_no: int = 1
    last_gap: Optional[str] = None       # re-teach differently on attempt 2+
    history: list[HistoryMessage] = Field(default_factory=list)
    message: str
    context_chunks: list[str] = Field(default_factory=list)  # RAG chunks from Laravel
    stream: bool = False


class ChatTurnMeta(BaseModel):
    """The tutor's structured 'mind' for the live right panel (spec D6/D9)."""
    concept_tags: list[str] = Field(default_factory=list)
    detected_misconception: Optional[str] = None
    resolved_misconception: Optional[str] = None
    mastery_signal: Optional[float] = None   # -1..1 how well the student is doing this turn
    difficulty_delta: int = 0                # -1 easier, 0 same, +1 harder
    next_step: Optional[str] = None
    suggested_render: str = "text"           # text | quiz | flashcards | canvas


class ChatTurnResponse(BaseModel):
    reply: str
    meta: ChatTurnMeta = Field(default_factory=ChatTurnMeta)
    usage: Usage = Field(default_factory=Usage)


class AssessmentGenerateRequest(BaseModel):
    student: StudentContext = Field(default_factory=StudentContext)
    topic: str
    count: int = 3
    concepts: list[str] = Field(default_factory=list)   # target weak concepts, if any
    difficulty: str = "auto"                            # easy | medium | hard | auto
    attempt_no: int = 1


class AssessmentGradeRequest(BaseModel):
    student: StudentContext = Field(default_factory=StudentContext)
    topic: str
    items: list[dict] = Field(default_factory=list)
    # each: {question, concept, type, answer_key, raw_answer}


class GapAnalyzeRequest(BaseModel):
    student: StudentContext = Field(default_factory=StudentContext)
    topic: str
    results: list[dict] = Field(default_factory=list)
    # each: {concept, question, is_correct, raw_answer?}


class PlanBuildRequest(BaseModel):
    student: StudentContext = Field(default_factory=StudentContext)
    topic: str
    gaps: list[dict] = Field(default_factory=list)


class ParentReportRequest(BaseModel):
    student: StudentContext = Field(default_factory=StudentContext)
    period: str = "weekly"
    stats: dict[str, Any] = Field(default_factory=dict)
