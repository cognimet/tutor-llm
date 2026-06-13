"""Neo4j knowledge graph — the GraphRAG "AI mind".

This is the *reasoning* layer that sits beside Qdrant. Qdrant owns every
embedding (curriculum, documents, events); Neo4j owns the **structure** and
references vectors only by their Qdrant point id. The graph holds:

  - the curriculum backbone  (:Stage)-[:HAS_TRACK]->…-[:HAS_TOPIC]->(:Topic)
  - concepts + ordering      (:Topic)-[:COVERS]->(:Concept), (:Topic)-[:NEXT]->(:Topic)
  - per-student state        (:User)-[:MASTERS]->(:Concept), HAS_MISCONCEPTION, FOCUS
  - uploaded documents       (:Note)-[:UPLOADED_BY]->(:User), (:Note)-[:ABOUT]->(:Topic)
  - every tracked action     (:Event {qdrant_id})-[:BY]->(:User), -[:ON]->(:Topic)

It powers two things: (1) graph-aware retrieval for the tutor (prerequisite
topics + the student's weak concepts), and (2) the cross-topic "next focus".

Degrades gracefully: if NEO4J_URI is unset or the driver errors, every call is
a safe no-op / empty result, so a chat turn is never broken by the graph.

Key choices
-----------
* Topics and Concepts are keyed by **name** (chat only ever knows a topic name),
  so events, mastery and curriculum all converge on the same node. Stage/Track/
  Level/Subject/Chapter/Note/Event are keyed by their Postgres id.
* `meta` maps are stored as a JSON string (Neo4j can't store nested maps).
"""
import json
import logging

from .config import settings

log = logging.getLogger("ai.graph")

_driver = None  # lazily-created AsyncDriver


def enabled() -> bool:
    return bool(settings.neo4j_uri)


def _get_driver():
    global _driver
    if _driver is None:
        from neo4j import AsyncGraphDatabase
        _driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
    return _driver


async def _run(query: str, **params):
    """Run one Cypher statement, returning a list of record dicts ([] on error)."""
    if not enabled():
        return []
    try:
        driver = _get_driver()
        async with driver.session() as session:
            res = await session.run(query, **params)
            return [r.data() async for r in res]
    except Exception as e:  # noqa: BLE001 — the graph is an enhancement, never fatal
        log.warning("neo4j query failed: %s", e)
        return []


async def close() -> None:
    global _driver
    if _driver is not None:
        try:
            await _driver.close()
        finally:
            _driver = None


# ── schema ──────────────────────────────────────────────────────────────
async def ensure_schema() -> None:
    """Create uniqueness constraints (idempotent). No vector index — vectors
    live in Qdrant; the graph only references point ids."""
    if not enabled():
        return
    stmts = [
        "CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE",
        "CREATE CONSTRAINT concept_name IF NOT EXISTS FOR (c:Concept) REQUIRE c.name IS UNIQUE",
        "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
        "CREATE CONSTRAINT stage_id IF NOT EXISTS FOR (s:Stage) REQUIRE s.id IS UNIQUE",
        "CREATE CONSTRAINT track_id IF NOT EXISTS FOR (t:Track) REQUIRE t.id IS UNIQUE",
        "CREATE CONSTRAINT level_id IF NOT EXISTS FOR (l:Level) REQUIRE l.id IS UNIQUE",
        "CREATE CONSTRAINT subject_id IF NOT EXISTS FOR (s:Subject) REQUIRE s.id IS UNIQUE",
        "CREATE CONSTRAINT chapter_id IF NOT EXISTS FOR (c:Chapter) REQUIRE c.id IS UNIQUE",
        "CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE",
        "CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE",
    ]
    for s in stmts:
        await _run(s)


# ── curriculum sync ───────────────────────────────────────────────────────
async def upsert_curriculum(topics: list[dict], next_pairs: list[list] | None = None,
                            concepts: list[dict] | None = None) -> int:
    """Mirror the Postgres hierarchy into the graph.

    `topics`: [{stage_id,stage,track_id,track,level_id,level,subject_id,subject,
                chapter_id,chapter,topic_id,topic,position}]
    `next_pairs`: [[prev_topic_name, topic_name], ...] (ordering within a chapter)
    `concepts`: [{topic, name}, ...]
    """
    if not enabled():
        return 0
    # graph:sync is the first real write and runs once Neo4j is up — make sure
    # the constraints exist even if the ai-service booted before Neo4j was ready.
    await ensure_schema()
    if topics:
        await _run(
            """
            UNWIND $topics AS t
            MERGE (st:Stage {id: t.stage_id})     SET st.name = t.stage
            MERGE (tr:Track {id: t.track_id})     SET tr.name = t.track
            MERGE (lv:Level {id: t.level_id})     SET lv.name = t.level
            MERGE (sb:Subject {id: t.subject_id}) SET sb.name = t.subject
            MERGE (ch:Chapter {id: t.chapter_id}) SET ch.name = t.chapter
            MERGE (tp:Topic {name: t.topic})      SET tp.id = t.topic_id, tp.position = t.position
            MERGE (st)-[:HAS_TRACK]->(tr)
            MERGE (tr)-[:HAS_LEVEL]->(lv)
            MERGE (lv)-[:HAS_SUBJECT]->(sb)
            MERGE (sb)-[:HAS_CHAPTER]->(ch)
            MERGE (ch)-[:HAS_TOPIC]->(tp)
            """,
            topics=topics,
        )
    if next_pairs:
        await _run(
            """
            UNWIND $pairs AS p
            MATCH (a:Topic {name: p[0]}), (b:Topic {name: p[1]})
            MERGE (a)-[:NEXT]->(b)
            """,
            pairs=next_pairs,
        )
    if concepts:
        await _run(
            """
            UNWIND $concepts AS c
            MATCH (tp:Topic {name: c.topic})
            MERGE (cc:Concept {name: c.name})
            MERGE (tp)-[:COVERS]->(cc)
            """,
            concepts=concepts,
        )
    return len(topics)


# ── per-student state ─────────────────────────────────────────────────────
async def set_state(user_id: int, name: str | None = None, mastery: list[dict] | None = None,
                    misconceptions: list[dict] | None = None, focus: dict | None = None) -> None:
    """Mirror MindService state into the graph.

    `mastery`: [{topic, concept, score, confidence}]
    `misconceptions`: [{topic, description, status}]
    `focus`: {topic, concept?, reason?}  (the single next focused area)
    """
    if not enabled():
        return
    await _run("MERGE (u:User {id:$uid}) SET u.name = coalesce($name, u.name)",
               uid=user_id, name=name)

    for ms in (mastery or []):
        await _run(
            """
            MATCH (u:User {id:$uid})
            MERGE (c:Concept {name:$concept})
            MERGE (t:Topic {name:$topic})
            MERGE (t)-[:COVERS]->(c)
            MERGE (u)-[r:MASTERS {topic:$topic}]->(c)
            SET r.score=$score, r.confidence=$confidence, r.last_seen=datetime()
            """,
            uid=user_id, concept=ms.get("concept"), topic=ms.get("topic"),
            score=float(ms.get("score", 0)), confidence=int(ms.get("confidence", 0)),
        )

    for mc in (misconceptions or []):
        await _run(
            """
            MATCH (u:User {id:$uid})
            MERGE (x:Misconception {user_id:$uid, topic:$topic, description:$desc})
            SET x.status=$status, x.updated=datetime()
            MERGE (u)-[:HAS_MISCONCEPTION]->(x)
            MERGE (t:Topic {name:$topic})
            MERGE (x)-[:ABOUT]->(t)
            """,
            uid=user_id, topic=mc.get("topic"), desc=mc.get("description"),
            status=mc.get("status", "open"),
        )

    if focus and focus.get("topic"):
        await _run("MATCH (:User {id:$uid})-[f:FOCUS]->() DELETE f", uid=user_id)
        await _run(
            """
            MATCH (u:User {id:$uid})
            MERGE (t:Topic {name:$topic})
            MERGE (u)-[f:FOCUS]->(t)
            SET f.priority=1, f.set_at=datetime(), f.concept=$concept, f.reason=$reason
            """,
            uid=user_id, topic=focus.get("topic"),
            concept=focus.get("concept"), reason=focus.get("reason"),
        )


# ── documents + events ────────────────────────────────────────────────────
async def link_note(note_id: int, title: str, topic: str | None,
                    user_id: int, qdrant_ids: list[str]) -> None:
    if not enabled():
        return
    await _run(
        """
        MERGE (u:User {id:$uid})
        MERGE (n:Note {id:$nid}) SET n.title=$title, n.qdrant_ids=$qids
        MERGE (n)-[:UPLOADED_BY]->(u)
        FOREACH (_ IN CASE WHEN $topic IS NULL THEN [] ELSE [1] END |
            MERGE (t:Topic {name:$topic}) MERGE (n)-[:ABOUT]->(t))
        """,
        uid=user_id, nid=note_id, title=title or "Note", qids=qdrant_ids, topic=topic,
    )


async def record_event(event_id: str, user_id: int, type: str, text: str,
                       topic: str | None = None, concepts: list[str] | None = None,
                       qdrant_id: str | None = None, ts: str | None = None,
                       meta: dict | None = None) -> None:
    """One node per tracked user action, linked to the user, topic and concepts.
    The action's embedding lives in Qdrant `events`; `qdrant_id` references it."""
    if not enabled():
        return
    await _run(
        """
        MERGE (u:User {id:$uid})
        CREATE (e:Event {id:$eid, type:$type, text:$text, qdrant_id:$qid,
                         ts: CASE WHEN $ts IS NULL THEN datetime() ELSE datetime($ts) END,
                         meta:$meta})
        MERGE (e)-[:BY]->(u)
        FOREACH (_ IN CASE WHEN $topic IS NULL THEN [] ELSE [1] END |
            MERGE (t:Topic {name:$topic}) MERGE (e)-[:ON]->(t))
        WITH e
        UNWIND (CASE WHEN $concepts IS NULL OR size($concepts)=0 THEN [null] ELSE $concepts END) AS cn
        FOREACH (_ IN CASE WHEN cn IS NULL THEN [] ELSE [1] END |
            MERGE (c:Concept {name:cn}) MERGE (e)-[:TOUCHES]->(c))
        """,
        uid=user_id, eid=event_id, type=type, text=(text or "")[:2000], qid=qdrant_id,
        topic=topic, concepts=[c for c in (concepts or []) if c], ts=ts,
        meta=json.dumps(meta or {}),
    )


# ── graph-aware retrieval reads ─────────────────────────────────────────────
async def prereq_topics(topic: str, k: int = 3) -> list[str]:
    """Topic names that come immediately before `topic` (its prerequisites)."""
    rows = await _run(
        "MATCH (prev:Topic)-[:NEXT]->(t:Topic {name:$topic}) RETURN prev.name AS name LIMIT $k",
        topic=topic, k=k,
    )
    return [r["name"] for r in rows if r.get("name")]


async def weak_concepts(user_id: int, topic: str, k: int = 4, threshold: float = 0.6) -> list[str]:
    """The student's lowest-scoring concepts for a topic (the weak spots to revisit)."""
    rows = await _run(
        """
        MATCH (u:User {id:$uid})-[m:MASTERS {topic:$topic}]->(c:Concept)
        WHERE m.score < $th
        RETURN c.name AS name ORDER BY m.score ASC LIMIT $k
        """,
        uid=user_id, topic=topic, th=threshold, k=k,
    )
    return [r["name"] for r in rows if r.get("name")]


async def next_focus(user_id: int) -> dict:
    """The single cross-topic next focused area: an explicit FOCUS if set,
    else the student's weakest observed concept, else {}."""
    rows = await _run(
        """
        MATCH (u:User {id:$uid})-[f:FOCUS]->(t:Topic)
        RETURN t.name AS topic, f.concept AS concept, f.reason AS reason
        LIMIT 1
        """,
        uid=user_id,
    )
    if rows:
        r = rows[0]
        return {"topic": r.get("topic"), "concept": r.get("concept"),
                "reason": r.get("reason"), "source": "focus"}
    rows = await _run(
        """
        MATCH (u:User {id:$uid})-[m:MASTERS]->(c:Concept)
        WHERE m.confidence > 0
        RETURN m.topic AS topic, c.name AS concept, m.score AS score
        ORDER BY m.score ASC LIMIT 1
        """,
        uid=user_id,
    )
    if rows:
        r = rows[0]
        return {"topic": r.get("topic"), "concept": r.get("concept"),
                "reason": f"weakest concept ({round((r.get('score') or 0) * 100)}% mastery)",
                "score": r.get("score"), "source": "mastery"}
    return {}


async def status() -> dict:
    out = {"enabled": enabled()}
    if not enabled():
        return out
    rows = await _run(
        """
        RETURN
          count{ (n:Topic) }   AS topics,
          count{ (n:Concept) } AS concepts,
          count{ (n:User) }    AS users,
          count{ (n:Event) }   AS events,
          count{ (n:Note) }    AS notes
        """
    )
    if rows:
        out.update(rows[0])
    return out
