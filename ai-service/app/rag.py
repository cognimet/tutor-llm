"""RAG over the curriculum vector store (Qdrant).

Grounds tutor turns and generated questions in vetted curriculum chunks to
prevent off-syllabus hallucination. Degrades gracefully: if Qdrant is not
configured, retrieval returns [] and the caller proceeds ungrounded.

Embedding backends (EMBED_BACKEND = auto|local|gemini|openai|mock):
  - local   -> fastembed, in-process, no API key, no external call (default)
               BAAI/bge-small-en-v1.5 (384-dim)
  - gemini  -> text-embedding-004 (768-dim)
  - openai  -> text-embedding-3-small (1536-dim), NATIVE OpenAI only
  - mock    -> deterministic hash vector, so topic-filtered retrieval still
               works offline even with nothing configured.

"auto" prefers local fastembed (most robust — works with OpenRouter LLMs,
which don't serve embeddings, and needs no Google key). The collection is
created with the active embedder's dimension; if you switch backends, the
collection is auto-recreated and content re-indexed on the next index run.
"""
import hashlib
import logging
import struct
import uuid

import httpx

from .config import settings

log = logging.getLogger("ai.rag")

_GEMINI_EMBED_MODEL = "text-embedding-004"      # 768-dim
_OPENAI_EMBED_MODEL = "text-embedding-3-small"  # 1536-dim
_LOCAL_DIM = 384                                # BAAI/bge-small-en-v1.5
_MOCK_DIM = 768

_local_model = None  # lazily-loaded fastembed instance


def _fastembed_available() -> bool:
    try:
        import fastembed  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def embed_provider() -> str:
    """Which embedding backend is active: local | gemini | openai | mock."""
    choice = (settings.embed_backend or "auto").lower()
    if choice in ("local", "gemini", "openai", "mock"):
        if choice == "local" and not _fastembed_available():
            log.warning("EMBED_BACKEND=local but fastembed not installed; using mock")
            return "mock"
        return choice
    # auto
    if settings.ai_mock:
        return "mock"
    if _fastembed_available():
        return "local"
    openai_native = bool(settings.openai_api_key) and "api.openai.com" in settings.openai_base_url
    if openai_native:
        return "openai"
    if settings.gemini_api_key:
        return "gemini"
    return "mock"


def embed_dim() -> int:
    return {"local": _LOCAL_DIM, "openai": 1536, "gemini": 768, "mock": _MOCK_DIM}[embed_provider()]


def _embed_local(text: str) -> list[float] | None:
    global _local_model
    try:
        if _local_model is None:
            from fastembed import TextEmbedding
            _local_model = TextEmbedding(model_name=settings.embed_local_model)
            log.info("loaded local embedder %s", settings.embed_local_model)
        vec = next(iter(_local_model.embed([text])))
        return vec.tolist()
    except Exception as e:  # noqa: BLE001
        log.warning("local embed failed: %s", e)
        return None


def _mock_vector(text: str, dim: int | None = None) -> list[float]:
    """Deterministic pseudo-embedding from a hash, normalised to unit length."""
    dim = dim or embed_dim()
    vals: list[float] = []
    counter = 0
    while len(vals) < dim:
        h = hashlib.sha256(f"{text}:{counter}".encode()).digest()
        # 8 floats per 32-byte digest (4 bytes each, mapped to [-1, 1]).
        for i in range(0, 32, 4):
            n = struct.unpack("<I", h[i:i + 4])[0]
            vals.append((n / 0xFFFFFFFF) * 2 - 1)
        counter += 1
    vals = vals[:dim]
    norm = sum(v * v for v in vals) ** 0.5 or 1.0
    return [v / norm for v in vals]


async def _embed_gemini(text: str) -> list[float] | None:
    url = f"{settings.gemini_base_url.rstrip('/')}/models/{_GEMINI_EMBED_MODEL}:embedContent"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, json={"content": {"parts": [{"text": text}]}},
                                  headers={"x-goog-api-key": settings.gemini_api_key})
            if r.status_code == 200:
                return r.json().get("embedding", {}).get("values")
            log.warning("gemini embed error %s", r.status_code)
    except httpx.HTTPError as e:
        log.warning("gemini embed failed: %s", e)
    return None


async def _embed_openai(text: str) -> list[float] | None:
    url = f"{settings.openai_base_url.rstrip('/')}/embeddings"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, json={"model": _OPENAI_EMBED_MODEL, "input": text},
                                  headers={"Authorization": f"Bearer {settings.openai_api_key}"})
            if r.status_code == 200:
                data = r.json().get("data", [])
                if data:
                    return data[0].get("embedding")
            log.warning("openai embed error %s", r.status_code)
    except httpx.HTTPError as e:
        log.warning("openai embed failed: %s", e)
    return None


async def embed(text: str) -> list[float]:
    """Return an embedding from the active backend; mock vector as last resort."""
    backend = embed_provider()
    vec = None
    if backend == "local":
        vec = _embed_local(text)
    elif backend == "openai":
        vec = await _embed_openai(text)
    elif backend == "gemini":
        vec = await _embed_gemini(text)
    return vec or _mock_vector(text)  # never block ingestion on an embed hiccup


def _client():
    from qdrant_client import AsyncQdrantClient
    return AsyncQdrantClient(url=settings.qdrant_url)


async def ensure_collection(collection: str | None = None) -> None:
    """Create the collection, recreating it if the embedder's dim changed.

    Defaults to the curriculum collection; pass a name to manage the
    `documents` / `events` collections (all share the active embedder's dim).
    """
    if not settings.qdrant_url:
        return
    collection = collection or settings.qdrant_collection
    from qdrant_client import models as qm
    dim = embed_dim()
    client = _client()
    try:
        exists = await client.collection_exists(collection)
        if exists:
            # If the existing collection's dimension no longer matches the
            # active embedder (e.g. switched gemini-768 -> local-384), drop and
            # recreate so indexing/retrieval don't fail on a size mismatch.
            info = await client.get_collection(collection)
            current = info.config.params.vectors.size
            if current == dim:
                return
            log.warning("collection dim %s != embedder dim %s — recreating", current, dim)
            await client.delete_collection(collection)
        await client.create_collection(
            collection_name=collection,
            vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
        )
        log.info("created qdrant collection %s (dim=%s, embedder=%s)",
                 collection, dim, embed_provider())
    finally:
        await client.close()


async def index(points: list[dict]) -> int:
    """Embed and upsert curriculum chunks.

    Each point: {id:int, topic:str, type:str, body:str, ...payload}. Returns the
    number indexed. No-op (0) if Qdrant isn't configured.
    """
    if not settings.qdrant_url or not points:
        return 0
    from qdrant_client import models as qm
    await ensure_collection()
    client = _client()
    try:
        structs = []
        for p in points:
            body = p.get("body", "")
            vector = await embed(f"{p.get('topic','')}: {body}")
            structs.append(qm.PointStruct(
                id=int(p["id"]),
                vector=vector,
                payload={
                    "topic": p.get("topic"),
                    "type": p.get("type"),
                    "body": body,
                    "chunk_id": int(p["id"]),
                },
            ))
        await client.upsert(collection_name=settings.qdrant_collection, points=structs)
        return len(structs)
    finally:
        await client.close()


async def delete_topic(topic: str) -> None:
    """Remove all chunks for a topic (used before re-indexing it)."""
    if not settings.qdrant_url:
        return
    from qdrant_client import models as qm
    client = _client()
    try:
        await client.delete(
            collection_name=settings.qdrant_collection,
            points_selector=qm.FilterSelector(filter=qm.Filter(must=[
                qm.FieldCondition(key="topic", match=qm.MatchValue(value=topic))
            ])),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("qdrant delete_topic failed: %s", e)
    finally:
        await client.close()


async def index_documents(user_id: int, note_id: int, topic: str | None,
                           chunks: list[str]) -> list[str]:
    """Embed + upsert an uploaded note's text chunks into the `documents`
    collection so the tutor can later retrieve the student's OWN material.
    Returns the Qdrant point ids (referenced from the graph's :Note node)."""
    chunks = [c for c in (c.strip() for c in chunks) if c]
    if not settings.qdrant_url or not chunks:
        return []
    from qdrant_client import models as qm
    await ensure_collection(settings.qdrant_doc_collection)
    client = _client()
    ids: list[str] = []
    try:
        structs = []
        for ch in chunks:
            pid = str(uuid.uuid4())
            vector = await embed(f"{topic or ''}: {ch}")
            structs.append(qm.PointStruct(id=pid, vector=vector, payload={
                "kind": "document", "user_id": int(user_id), "note_id": int(note_id),
                "topic": topic, "body": ch,
            }))
            ids.append(pid)
        await client.upsert(collection_name=settings.qdrant_doc_collection, points=structs)
        return ids
    except Exception as e:  # noqa: BLE001
        log.warning("index_documents failed: %s", e)
        return ids
    finally:
        await client.close()


async def index_event(user_id: int, type: str, topic: str | None, text: str) -> str | None:
    """Embed one tracked user action into the `events` collection for semantic
    recall ("what has this student struggled with?"). Returns the point id."""
    text = (text or "").strip()
    if not settings.qdrant_url or not text:
        return None
    from qdrant_client import models as qm
    await ensure_collection(settings.qdrant_event_collection)
    client = _client()
    pid = str(uuid.uuid4())
    try:
        vector = await embed(f"{type} {topic or ''}: {text}")
        await client.upsert(collection_name=settings.qdrant_event_collection, points=[
            qm.PointStruct(id=pid, vector=vector, payload={
                "kind": "event", "user_id": int(user_id), "type": type,
                "topic": topic, "body": text[:2000],
            })])
        return pid
    except Exception as e:  # noqa: BLE001
        log.warning("index_event failed: %s", e)
        return None
    finally:
        await client.close()


async def _search(collection: str, text: str, k: int, must: list | None = None) -> list[str]:
    """Vector search one collection; returns chunk bodies ([] on any error)."""
    if not settings.qdrant_url:
        return []
    try:
        from qdrant_client import models as qm
        vector = await embed(text)
        client = _client()
        try:
            flt = qm.Filter(must=must) if must else None
            res = await client.query_points(collection_name=collection, query=vector,
                                            limit=k, query_filter=flt, with_payload=True)
            return [p.payload.get("body", "") for p in res.points if p.payload]
        finally:
            await client.close()
    except Exception as e:  # noqa: BLE001 — a missing collection / down store is fine
        log.debug("search %s failed: %s", collection, e)
        return []


def _topic_filter(topic: str | None):
    from qdrant_client import models as qm
    return [qm.FieldCondition(key="topic", match=qm.MatchValue(value=topic))] if topic else None


async def retrieve(query: str, topic: str | None = None, student_id: int | None = None,
                   k: int | None = None) -> list[str]:
    """Graph-aware retrieval. Layers vetted curriculum, prerequisite material,
    the student's weak-concept material, and the student's own notes.

    1) Qdrant `curriculum`, topic-filtered (the vetted source of truth).
    2) Neo4j → prerequisite topics + the student's weak concepts → Qdrant those.
    3) Qdrant `documents` filtered to the student (their uploaded notes).

    Returns [] (never raises) when retrieval is unavailable, so the tutor still
    works ungrounded.
    """
    if not settings.qdrant_url:
        return []
    k = k or settings.rag_top_k
    out: list[str] = []
    seen: set[str] = set()

    def add(bodies: list[str]) -> None:
        for b in bodies:
            b = (b or "").strip()
            key = b[:120]
            if b and key not in seen:
                seen.add(key)
                out.append(b)

    # 1) primary curriculum search (preserve the old topic-prefixed query)
    add(await _search(settings.qdrant_collection,
                      query if not topic else f"{topic}: {query}", k, _topic_filter(topic)))

    # 2) graph expansion: prerequisite topics + this student's weak concepts
    if topic:
        try:
            from . import graph
            for pt in await graph.prereq_topics(topic, k=2):
                add(await _search(settings.qdrant_collection, f"{pt}: {pt}", 2, _topic_filter(pt)))
            if student_id:
                for w in await graph.weak_concepts(student_id, topic, k=3):
                    add(await _search(settings.qdrant_collection, f"{topic}: {w}", 2, _topic_filter(topic)))
        except Exception as e:  # noqa: BLE001
            log.debug("graph expansion skipped: %s", e)

    # 3) the student's own uploaded documents for this topic
    if student_id:
        from qdrant_client import models as qm
        must = [qm.FieldCondition(key="user_id", match=qm.MatchValue(value=int(student_id)))]
        if topic:
            must.append(qm.FieldCondition(key="topic", match=qm.MatchValue(value=topic)))
        add(await _search(settings.qdrant_doc_collection, f"{topic or ''}: {query}", 3, must))

    return out[: max(k, 6)]


async def status() -> dict:
    """Vector-store status for health/debugging: enabled, collection, points."""
    out = {
        "enabled": bool(settings.qdrant_url),
        "collection": settings.qdrant_collection,
        "embedder": embed_provider(),
        "dim": embed_dim(),
        "points": None,
    }

    # DEFINITIVE probe: actually run the active embedder once. "embedder" only
    # says which backend is SELECTED; if the local model failed to download,
    # per-call embedding silently falls back to a mock vector. This makes the
    # difference visible.
    if out["embedder"] == "local":
        vec = _embed_local("healthcheck probe")
        out["local_embed_ok"] = vec is not None
        out["probe_dim"] = len(vec) if vec else None
        if vec is None:
            out["warning"] = ("fastembed selected but embedding FAILED — vectors are "
                              "falling back to mock. Usually the HF model download was "
                              "blocked on first use; check ai-service logs.")
    elif out["embedder"] == "mock":
        out["local_embed_ok"] = False
        out["probe_dim"] = _MOCK_DIM
    if not settings.qdrant_url:
        return out
    try:
        client = _client()
        try:
            async def _count(name):
                if await client.collection_exists(name):
                    return (await client.get_collection(name)).points_count
                return 0
            out["points"] = await _count(settings.qdrant_collection)
            out["documents"] = await _count(settings.qdrant_doc_collection)
            out["events"] = await _count(settings.qdrant_event_collection)
        finally:
            await client.close()
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)
    return out


def as_context(chunks: list[str]) -> str:
    if not chunks:
        return ""
    joined = "\n---\n".join(c.strip() for c in chunks if c.strip())
    return (
        "\n\nUse ONLY the following curriculum material as your source of truth. "
        "If it doesn't cover the question, say so briefly and teach from first principles:\n"
        f"<curriculum>\n{joined}\n</curriculum>\n"
    )
