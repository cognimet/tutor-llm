"""AI Tutor — Python AI service (FastAPI).

The single home for all LLM/RAG/embedding work. Laravel (system of record)
calls these endpoints over internal REST; this service never touches the
product database. Every response carries token `usage` for metering.

Roles -> endpoints:
  POST /ai/chat/turn            teacher (grounded explanation + signals)
  POST /ai/chat/stream          teacher, streamed (SSE)
  POST /ai/assessment/generate  diagnostic questions
  POST /ai/assessment/grade     grade open answers + name misconceptions
  POST /ai/gap/analyze          concept gaps + root cause
  POST /ai/plan/build           study plan from gaps
  POST /ai/notes/ingest         summarise notes -> flashcards (+ index for RAG)
  GET  /health
"""
import json
import logging

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import settings
from .llm import llm
from . import prompts, rag
from .schemas import (
    ChatTurnRequest, ChatTurnResponse,
    AssessmentGenerateRequest, AssessmentGenerateResponse, Question,
    AssessmentGradeRequest, AssessmentGradeResponse, GradedItem,
    GapAnalyzeRequest, GapAnalyzeResponse, Gap,
    PlanBuildRequest, PlanBuildResponse, PlanItem,
    NotesIngestRequest, NotesIngestResponse, Usage,
)

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="AI Tutor — AI Service", version="1.0.0")


def _auth(authorization: str | None) -> None:
    """Simple shared-secret guard so only Laravel can call this service."""
    if not settings.internal_api_key:
        return  # open in local/dev if no key set
    expected = f"Bearer {settings.internal_api_key}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "mock": settings.is_mock,
        "provider": settings.resolved_provider,
        "model": settings.resolved_model,
        "routing": settings.routing_table,
        "single_model": bool(settings.ai_model),
        "rag": bool(settings.qdrant_url),
        "embedder": rag.embed_provider(),
    }


# ── Generic passthrough (lets Laravel route its existing prompts through the
#    one AI service so it never calls the LLM directly; returns token usage). ──
class TextRequest(BaseModel):
    system: str
    user: str
    topic: str | None = None        # when set, RAG curriculum context is injected
    rag_query: str | None = None    # text to retrieve on (defaults to `user`)
    action: str = "chat"            # model-routing group: chat|structured|grade


class JsonRequest(BaseModel):
    system: str
    user: str
    fallback: dict = {}
    topic: str | None = None
    rag_query: str | None = None
    action: str = "structured"      # model-routing group: chat|structured|grade


async def _ground(system: str, topic: str | None, query: str) -> str:
    """Prepend retrieved curriculum context to a system prompt when a topic is set."""
    if not topic:
        return system
    chunks = await rag.retrieve(query, topic=topic)
    return system + rag.as_context(chunks)


@app.post("/ai/text")
async def ai_text(req: TextRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system = await _ground(req.system, req.topic, req.rag_query or req.user)
    out, usage = await llm.text(system, req.user, action=req.action)
    return {"text": out, "usage": usage.model_dump()}


@app.post("/ai/json")
async def ai_json(req: JsonRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system = await _ground(req.system, req.topic, req.rag_query or req.user)
    out, usage = await llm.json(system, req.user, req.fallback, action=req.action)
    return {"data": out, "usage": usage.model_dump()}


@app.post("/ai/stream")
async def ai_stream(req: TextRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system = await _ground(req.system, req.topic, req.rag_query or req.user)

    async def gen():
        final_usage = None
        async for delta, usage in llm.stream(system, req.user, action=req.action):
            if delta:
                yield f"data: {json.dumps({'delta': delta})}\n\n"
            if usage is not None:
                final_usage = usage
        yield f"data: {json.dumps({'done': True, 'usage': final_usage.model_dump() if final_usage else None})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


# ── Curriculum indexing (RAG ingestion) ────────────────────────────────
class IndexPoint(BaseModel):
    id: int
    topic: str
    type: str = "explainer"
    body: str


class IndexRequest(BaseModel):
    points: list[IndexPoint]


@app.post("/ai/embed/index")
async def embed_index(req: IndexRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    n = await rag.index([p.model_dump() for p in req.points])
    return {"indexed": n, "rag_enabled": bool(settings.qdrant_url)}


@app.post("/ai/embed/ensure")
async def embed_ensure(authorization: str | None = Header(None)):
    _auth(authorization)
    await rag.ensure_collection()
    return {"ok": True, "rag_enabled": bool(settings.qdrant_url)}


class DeleteTopicRequest(BaseModel):
    topic: str


@app.post("/ai/embed/delete-topic")
async def embed_delete_topic(req: DeleteTopicRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    await rag.delete_topic(req.topic)
    return {"ok": True}


@app.post("/ai/chat/turn", response_model=ChatTurnResponse)
async def chat_turn(req: ChatTurnRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    chunks = await rag.retrieve(req.message, topic=req.topic)
    system, user = prompts.chat_turn(req, rag.as_context(chunks))
    reply, usage = await llm.text(system, user, action="chat")

    # Second, cheap call for structured signals (skipped in mock to save a hop).
    tags, misconception, delta, render, nxt = [], None, 0, "text", None
    if not settings.is_mock and reply:
        ms, mu = prompts.chat_metadata(req, reply)
        meta, meta_usage = await llm.json(ms, mu, {}, action="grade")
        if isinstance(meta, dict):
            tags = meta.get("concept_tags", []) or []
            misconception = meta.get("detected_misconception")
            delta = int(meta.get("difficulty_delta", 0) or 0)
            render = meta.get("suggested_render", "text") or "text"
            nxt = meta.get("next_step")
        usage = _merge_usage(usage, meta_usage)

    return ChatTurnResponse(
        reply=reply, concept_tags=tags, detected_misconception=misconception,
        difficulty_delta=delta, suggested_render=render, next_step=nxt, usage=usage,
    )


@app.post("/ai/chat/stream")
async def chat_stream(req: ChatTurnRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    chunks = await rag.retrieve(req.message, topic=req.topic)
    system, user = prompts.chat_turn(req, rag.as_context(chunks))

    async def gen():
        final_usage: Usage | None = None
        async for delta, usage in llm.stream(system, user, action="chat"):
            if delta:
                yield f"data: {json.dumps({'delta': delta})}\n\n"
            if usage is not None:
                final_usage = usage
        payload = {"done": True, "usage": (final_usage.model_dump() if final_usage else None)}
        yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/ai/assessment/generate", response_model=AssessmentGenerateResponse)
async def assessment_generate(req: AssessmentGenerateRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.assessment_generate(req.student, req.topic, req.count)
    data, usage = await llm.json(system, user, {"questions": []}, action="structured")
    questions = [Question(**_q) for _q in _safe_list(data, "questions")]
    return AssessmentGenerateResponse(questions=questions, usage=usage)


@app.post("/ai/assessment/grade", response_model=AssessmentGradeResponse)
async def assessment_grade(req: AssessmentGradeRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    # Deterministic grading for exact-match types; LLM only for open answers.
    open_items = [it for it in req.items if it.type not in ("mcq", "truefalse", "numeric", "fill")]
    graded: list[GradedItem] = []
    for it in req.items:
        if it.type in ("mcq", "truefalse", "numeric", "fill"):
            ok = it.student_answer.strip().lower() == it.correct_answer.strip().lower()
            graded.append(GradedItem(concept=it.concept, is_correct=ok,
                                     partial_score=1.0 if ok else 0.0,
                                     feedback="Correct" if ok else "Not quite"))
    usage = Usage(model=settings.model_for("grade"), mock=settings.is_mock)
    if open_items:
        system, user = prompts.assessment_grade(req.topic, open_items)
        data, usage = await llm.json(system, user, {"graded": []}, action="grade")
        for g in _safe_list(data, "graded"):
            graded.append(GradedItem(**g))
    return AssessmentGradeResponse(graded=graded, usage=usage)


@app.post("/ai/gap/analyze", response_model=GapAnalyzeResponse)
async def gap_analyze(req: GapAnalyzeRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.gap_analyze(req.topic, req.results)
    data, usage = await llm.json(system, user, {"gaps": [], "summary": ""}, action="structured")
    gaps = [Gap(**g) for g in _safe_list(data, "gaps")]
    summary = data.get("summary", "") if isinstance(data, dict) else ""
    return GapAnalyzeResponse(gaps=gaps, summary=summary, usage=usage)


@app.post("/ai/plan/build", response_model=PlanBuildResponse)
async def plan_build(req: PlanBuildRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.plan_build(req.topic, req.gaps)
    data, usage = await llm.json(system, user, {"title": "Your next steps", "items": []}, action="structured")
    items = [PlanItem(**i) for i in _safe_list(data, "items")]
    title = data.get("title", "Your next steps") if isinstance(data, dict) else "Your next steps"
    return PlanBuildResponse(title=title, items=items, usage=usage)


@app.post("/ai/notes/ingest", response_model=NotesIngestResponse)
async def notes_ingest(req: NotesIngestRequest, authorization: str | None = Header(None)):
    _auth(authorization)
    system, user = prompts.notes_ingest(req.text, req.topic)
    data, usage = await llm.json(system, user, {"summary": "", "flashcards": []}, action="structured")
    summary = data.get("summary", "") if isinstance(data, dict) else ""
    flashcards = _safe_list(data, "flashcards")
    # (Indexing the notes into Qdrant for RAG is a worker job; reported as 0 here.)
    return NotesIngestResponse(summary=summary, flashcards=flashcards,
                               chunks_indexed=0, usage=usage)


# ── helpers ────────────────────────────────────────────────────────────
def _safe_list(data, key: str) -> list:
    if isinstance(data, dict) and isinstance(data.get(key), list):
        return data[key]
    if isinstance(data, list) and key in ("questions", "items", "graded", "gaps", "flashcards"):
        return data
    return []


def _merge_usage(a: Usage, b: Usage) -> Usage:
    return Usage(
        model=a.model,
        prompt_tokens=a.prompt_tokens + b.prompt_tokens,
        completion_tokens=a.completion_tokens + b.completion_tokens,
        total_tokens=a.total_tokens + b.total_tokens,
        mock=a.mock or b.mock,
    )
