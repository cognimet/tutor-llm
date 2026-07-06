import React, { useEffect, useMemo } from "react";
import Markdown from "./Markdown.jsx";
import Visualization, { parseVizSpec } from "./Visualization.jsx";
import LessonSegment from "./LessonSegment.jsx";
import ProgressGate from "./ProgressGate.jsx";
import BentoGrid from "./BentoGrid.jsx";
import VocabPill from "./VocabPill.jsx";
import LessonProgressiveWrapper from "./LessonProgressiveWrapper.jsx";
import { FloatingStreakBadge } from "./FloatingStreakBadge.jsx";
import DiagramNode from "./DiagramNode.jsx";

/**
 * Renders a tutor message, splicing inline visualizations into the Markdown.
 *
 * The tutor emits visualizations as fenced blocks tagged viz/chart/plot/graph,
 * e.g.  ```viz\n{ "type": "function", "expr": "x^2", "domain": [-5,5] }\n```
 * We render the prose around them as Markdown and each block as a <Visualization>.
 *
 * Streaming-safe: a viz fence that hasn't closed yet (still arriving) renders a
 * lightweight placeholder instead of a half-parsed chart, so nothing flickers
 * or throws mid-stream.
 */

// Language tags that ALWAYS mean a visualization.
const VIZ_LANGS = new Set(["viz", "chart", "plot", "graph"]);
// Recognised spec `type` values (must mirror Visualization.jsx).
const VIZ_TYPES = new Set(["function", "plot", "line", "bar", "scatter", "pie",
  "geometry", "diagram", "mermaid", "flowchart"]);

// Match ANY fenced code block: group1 = backtick run, group2 = info/lang,
// group3 = content. Tolerates 3+ backticks and CRLF.
const ANY_FENCE = /(`{3,})[ \t]*([^\n`]*)\r?\n([\s\S]*?)\1/g;
// An unterminated, explicitly-tagged viz fence (used for the streaming spinner).
const OPEN_VIZ = /(`{3,})[ \t]*(?:viz|chart|plot|graph)\b[^\n]*\r?\n/i;

// Is this fenced body a visualization spec? Returns true when the content is a
// JSON object with a recognised `type`. This catches specs the model mislabels
// as ```json (or leaves untagged) instead of ```viz.
function looksLikeVizSpec(content) {
  const t = content.trim();
  if (t[0] !== "{" && t[0] !== "[") return false;
  const o = parseVizSpec(t); // tolerant of raw newlines/tabs inside string values
  return !!o && typeof o === "object" && typeof o.type === "string"
    && VIZ_TYPES.has(o.type.toLowerCase());
}

// A lone marker line the model sometimes leaves above a bare spec (e.g. `viz`).
const LONE_MARKER = /^[ \t]*`?(?:viz|chart|plot|graph)`?[ \t]*$/i;

// Within a stretch of Markdown, also rescue visualization specs the model emitted
// WITHOUT a proper code fence — e.g. an inline `viz` marker followed by a bare
// minified JSON object on its own line. Returns interleaved md/viz segments.
function rescueBareViz(md) {
  if (!md || md.indexOf("{") === -1) return md ? [{ kind: "md", text: md }] : [];
  const lines = md.split(/\r?\n/);
  const out = [];
  let buf = [];
  const flushMd = () => { if (buf.length) { out.push({ kind: "md", text: buf.join("\n") }); buf = []; } };
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 1 && (t[0] === "{" || t[0] === "[") && looksLikeVizSpec(t)) {
      while (buf.length && LONE_MARKER.test(buf[buf.length - 1])) buf.pop(); // drop a `viz` marker above it
      flushMd();
      out.push({ kind: "viz", code: t });
    } else {
      buf.push(line);
    }
  }
  flushMd();
  return out;
}

function splitSegments(text, streaming = false) {
  const src = String(text || "");
  // 1) Find fenced viz blocks (explicit viz langs, or json/untagged with viz content).
  const fenced = [];
  let m;
  ANY_FENCE.lastIndex = 0;
  while ((m = ANY_FENCE.exec(src))) {
    const lang = (m[2] || "").trim().toLowerCase();
    const content = m[3];
    const isViz = VIZ_LANGS.has(lang)
      || ((lang === "" || lang === "json" || lang === "json5") && looksLikeVizSpec(content));
    if (isViz) fenced.push({ start: m.index, end: m.index + m[0].length, code: content.trim() });
  }
  // 2) Walk the source, emitting fenced viz blocks and — in the gaps — rescuing
  //    any bare/inline viz specs the model didn't fence.
  const segs = [];
  let cursor = 0;
  for (const f of fenced) {
    if (f.start > cursor) segs.push(...rescueBareViz(src.slice(cursor, f.start)));
    segs.push({ kind: "viz", code: f.code });
    cursor = f.end;
  }
  const tail = src.slice(cursor);
  const openAt = tail.search(OPEN_VIZ);
  if (openAt >= 0 && streaming) {
    // An unterminated viz fence still streaming in: prose before it, then a spinner.
    if (openAt > 0) segs.push(...rescueBareViz(tail.slice(0, openAt)));
    segs.push({ kind: "viz-pending" });
  } else if (tail) {
    // Finished render (or no open fence): flush the tail as prose — never a spinner.
    segs.push(...rescueBareViz(tail));
  }
  return segs;
}

function PendingViz() {
  return (
    <div className="my-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-indigo-400" />
      Preparing visualization…
    </div>
  );
}

/** Renders prose with inline visualizations (the original RichMessage body). */
function Segments({ text, streaming = false }) {
  const segments = useMemo(() => splitSegments(text, streaming), [text, streaming]);
  const lastMdIdx = (() => {
    for (let i = segments.length - 1; i >= 0; i--) if (segments[i].kind === "md") return i;
    return -1;
  })();
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "viz") return <Visualization key={i} code={seg.code} />;
        if (seg.kind === "viz-pending") return <PendingViz key={i} />;
        return <Markdown key={i} text={seg.text} streaming={streaming && i === lastMdIdx} />;
      })}
    </>
  );
}

/* ----------------- Interactive blocks (Visual Learning spec) ---------------- */

// [CARD: concept|analogy|vocab title="…" page=N fig="…"] body [/CARD]
const CARD_RE = /\[CARD:\s*(concept|analogy|vocab)\s+title="([^"]*)"\s*(?:page=(\d+))?\s*(?:fig="([^"]*)")?\s*\]([\s\S]*?)\[\/CARD\]/gi;
// [QUIZ: id correct=N ans="exact answer"] question [OPTIONS] - a\n- b [EXPLANATION] feedback [/QUIZ]
// ans="…" is optional but, when present, is the SOURCE OF TRUTH for grading — it
// guards against the model emitting a wrong/off-by-one `correct` index.
// [EXPLANATION] is ALSO optional: if the model omits it, the quiz must still
// render as an interactive gate (never dump raw [QUIZ]…[/QUIZ] markup as text).
const QUIZ_RE = /\[QUIZ:\s*([^\s\]]+)\s+correct=(\d+)\s*(?:ans="([^"]*)")?\s*\]([\s\S]*?)\[OPTIONS\]([\s\S]*?)(?:\[EXPLANATION\]([\s\S]*?))?\[\/QUIZ\]/gi;
// [VISUAL_ANCHOR: page=N fig="…" text="…"]
const ANCHOR_RE = /\[VISUAL_ANCHOR:\s*(?:page=(\d+))?\s*(?:fig="([^"]*)")?\s*(?:text="([^"]*)")?\s*\]/gi;
// Storybook containers + standalone tags (Fancy Learning spec).
const BENTO_RE = /\[BENTO_GRID\]([\s\S]*?)\[\/BENTO_GRID\]/gi;   // side-by-side cards
const FLOW_RE = /\[PROGRESSIVE_FLOW\]([\s\S]*?)\[\/PROGRESSIVE_FLOW\]/gi; // step-by-step reveal
const STREAK_RE = /\[STREAK\b([^\]]*)\]/gi;                      // floating combo badge
// [VOCAB word="…" def="…"] — inline pills, handled within prose & card bodies.
const VOCAB_RE = /\[VOCAB\s+word="([^"]*)"\s+def="([^"]*)"\s*\]/gi;
// <diagram_sketch|original|cleaned|normalized|isolated id="X" /> — a student's
// own diagram (UVSS reconstruction or a rendered image), resolved by node id
// via DiagramNode, INLINE in the chat flow.
const DIAGRAM_RE = /<diagram_(sketch|original|cleaned|normalized|isolated)\s+id\s*=\s*["']?(\d+)["']?\s*\/?>/gi;
// <ShowIsolatedDiagram id="X" /> — Diagram Isolation upgrade §5.2: NEVER
// rendered inline. Intercepted and dispatched to React state (onShowDiagram),
// which tells the study layout to display the perfectly isolated asset in the
// dedicated, sticky Visual Context Viewer pane beside the chat.
const SHOW_DIAG_RE = /<ShowIsolatedDiagram\s+id\s*=\s*["']?(\d+)["']?\s*\/?>/gi;
// Cheap presence check (fast path: most messages have no tags → render unchanged).
// The `<diagram_` / `<Show` PREFIXES (not just complete tag names) are included
// so that a tag still streaming in — e.g. `<ShowIsolatedDia` at the very start
// of a reply, where the isolation protocol places it — routes into the
// interactive parser, whose OPEN_TAG hold-back hides it until it completes.
const HAS_TAG = /(\[(?:CARD:|QUIZ:|VISUAL_ANCHOR:|BENTO_GRID\]|PROGRESSIVE_FLOW\]|STREAK\b|VOCAB\s))|<diagram_[a-z]*|<Show[A-Za-z]*/i;
// An opening of a block tag still streaming in (no closing yet) → held back.
const OPEN_TAG = /\[(?:CARD:|QUIZ:|VISUAL_ANCHOR:|BENTO_GRID\]|PROGRESSIVE_FLOW\]|STREAK\b)|<diagram_[a-z]*|<Show[A-Za-z]*/i;

// When a stream is truncated (token limit, dropped connection, parse mismatch),
// it can end mid-tag — leaving an unclosed [CARD]/[QUIZ] that would otherwise
// render a permanent "Building your card…" placeholder. On a FINISHED render we
// auto-close any unbalanced block tags so the content parses into real cards /
// quizzes instead of getting stuck. No-op while streaming (let it arrive).
export function sanitizeLessonStream(content) {
  let s = String(content || "");
  const count = (re) => (s.match(re) || []).length;

  if (count(/\[CARD:/gi) > count(/\[\/CARD\]/gi)) s += "\n[/CARD]";

  if (count(/\[QUIZ:/gi) > count(/\[\/QUIZ\]/gi)) {
    // Synthesize the sections the parser needs so a half-streamed quiz degrades
    // into a readable block rather than a stuck loader.
    if (!/\[OPTIONS\]/i.test(s)) s += "\n[OPTIONS]\n- (still loading…)";
    if (!/\[EXPLANATION\]/i.test(s)) s += "\n[EXPLANATION]\n(Keep going — you've got this!)";
    s += "\n[/QUIZ]";
  }

  // Close container wrappers too, so their inner cards still render.
  if (count(/\[BENTO_GRID\]/gi) > count(/\[\/BENTO_GRID\]/gi)) s += "\n[/BENTO_GRID]";
  if (count(/\[PROGRESSIVE_FLOW\]/gi) > count(/\[\/PROGRESSIVE_FLOW\]/gi)) s += "\n[/PROGRESSIVE_FLOW]";

  return s;
}

// Loosely read a numeric attribute (streak=3 / xp=20) from a tag's attr string.
const numAttr = (s, name) => { const m = new RegExp(name + "\\s*=\\s*(\\d+)").exec(s || ""); return m ? parseInt(m[1], 10) : undefined; };

// Stable, compact hash (FNV-1a → base36) used to build a durable target_id for
// each interactive block, so its DB-logged state re-hydrates on reload.
function blockHash(text) {
  const s = String(text || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const gateHash = (question, options) => blockHash(String(question) + "|" + (options || []).join("|"));

// Pull any [VISUAL_ANCHOR] tags out of a body string (so they never render as
// raw text), collecting them into anchorsOut so they still drive the left pane.
function stripAnchors(body, anchorsOut) {
  return String(body || "").replace(ANCHOR_RE, (_full, page, fig, txt) => {
    anchorsOut.push({ page: page ? parseInt(page, 10) : undefined, figureId: fig || undefined, highlightText: txt || undefined });
    return "";
  }).trim();
}

// Extract the [CARD]s nested inside a container's inner content.
function parseCards(inner, anchorsOut = []) {
  const cards = [];
  let m;
  CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(inner)) !== null) {
    const [, kind, title, page, fig, body] = m;
    cards.push({
      cardType: kind, title, body: stripAnchors(body, anchorsOut),
      anchor: page || fig ? { page: page ? parseInt(page, 10) : undefined, figureId: fig || undefined } : null,
    });
  }
  return cards;
}

function parseInteractive(text, streaming = false) {
  const src = String(text || "");
  const matches = [];
  let m;
  CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(src)) !== null) matches.push({ type: "card", index: m.index, end: m.index + m[0].length, m });
  QUIZ_RE.lastIndex = 0;
  while ((m = QUIZ_RE.exec(src)) !== null) matches.push({ type: "quiz", index: m.index, end: m.index + m[0].length, m });
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(src)) !== null) matches.push({ type: "anchor", index: m.index, end: m.index + m[0].length, m });
  BENTO_RE.lastIndex = 0;
  while ((m = BENTO_RE.exec(src)) !== null) matches.push({ type: "bento", index: m.index, end: m.index + m[0].length, m });
  FLOW_RE.lastIndex = 0;
  while ((m = FLOW_RE.exec(src)) !== null) matches.push({ type: "flow", index: m.index, end: m.index + m[0].length, m });
  STREAK_RE.lastIndex = 0;
  while ((m = STREAK_RE.exec(src)) !== null) matches.push({ type: "streak", index: m.index, end: m.index + m[0].length, m });
  DIAGRAM_RE.lastIndex = 0;
  while ((m = DIAGRAM_RE.exec(src)) !== null) matches.push({ type: "diagram", index: m.index, end: m.index + m[0].length, m });
  SHOW_DIAG_RE.lastIndex = 0;
  while ((m = SHOW_DIAG_RE.exec(src)) !== null) matches.push({ type: "showdiagram", index: m.index, end: m.index + m[0].length, m });
  matches.sort((a, b) => a.index - b.index);

  const blocks = [];
  const anchors = [];
  const showDiagrams = [];   // isolated-diagram ids for the Visual Context Viewer
  let cursor = 0;
  const pushText = (t) => { if (t && t.trim()) blocks.push({ kind: "text", text: t }); };

  for (const tag of matches) {
    if (tag.index < cursor) continue; // skip overlaps (e.g. anchor inside a card body)
    pushText(src.slice(cursor, tag.index));
    if (tag.type === "card") {
      const [, kind, title, page, fig, body] = tag.m;
      blocks.push({
        kind: "card", cardType: kind, title, body: stripAnchors(body, anchors),
        anchor: page || fig ? { page: page ? parseInt(page, 10) : undefined, figureId: fig || undefined } : null,
      });
    } else if (tag.type === "quiz") {
      const [, id, correct, ans, question, optionsText, explanation] = tag.m;
      const options = (optionsText || "").trim().split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
      blocks.push({ kind: "quiz", id, question: (question || "").trim(), options, correct: parseInt(correct, 10) || 0, correctText: (ans || "").trim(), explanation: (explanation || "").trim() });
    } else if (tag.type === "anchor") {
      const [, page, fig, txt] = tag.m;
      anchors.push({ page: page ? parseInt(page, 10) : undefined, figureId: fig || undefined, highlightText: txt || undefined });
    } else if (tag.type === "bento") {
      stripAnchors(tag.m[1] || "", anchors);              // collect any anchors in the container
      blocks.push({ kind: "bento", cards: parseCards(tag.m[1] || "", []) }); // clean card bodies
    } else if (tag.type === "flow") {
      stripAnchors(tag.m[1] || "", anchors);
      blocks.push({ kind: "flow", cards: parseCards(tag.m[1] || "", []) });
    } else if (tag.type === "streak") {
      blocks.push({ kind: "streak", streak: numAttr(tag.m[1], "streak") ?? 3, xp: numAttr(tag.m[1], "xp") ?? 20 });
    } else if (tag.type === "diagram") {
      const [, variant, id] = tag.m;
      blocks.push({ kind: "diagram", variant, nodeId: parseInt(id, 10) });
    } else if (tag.type === "showdiagram") {
      // Stream interception (isolation plan §5.2): the tag is NOT rendered as
      // an inline <img>. It's collected so the layout can display the isolated
      // asset in the dedicated viewer; a small chip marks the spot in the
      // transcript and re-opens the viewer on tap.
      const nodeId = parseInt(tag.m[1], 10);
      showDiagrams.push(nodeId);
      blocks.push({ kind: "showdiagram", nodeId });
    }
    cursor = tag.end;
  }

  // Tail: while streaming, hold back a tag that's still arriving (show a brief
  // placeholder). On a finished render, sanitizeLessonStream has already closed
  // balanced tags, so anything still "open" here is malformed — flush it as plain
  // text rather than leaving a stuck loader.
  const tail = src.slice(cursor);
  const openAt = tail.search(OPEN_TAG);
  if (openAt >= 0 && streaming) {
    pushText(tail.slice(0, openAt));
    blocks.push({ kind: "pending" });
  } else {
    pushText(tail);
  }

  return { blocks, anchors, showDiagrams };
}

function PendingBlock() {
  return (
    <div className="my-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-slate-800/60">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-emerald-400" /> Building your card…
    </div>
  );
}

// Minimal inline Markdown (bold/italic/code) → React nodes, so vocab pills can
// sit inline within a sentence without full block-level Markdown breaking flow.
function inlineNodes(text, keyBase = "i") {
  const nodes = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] != null || m[3] != null) nodes.push(<strong key={`${keyBase}-${k++}`}>{m[2] ?? m[3]}</strong>);
    else if (m[4] != null) nodes.push(<em key={`${keyBase}-${k++}`}>{m[4]}</em>);
    else if (m[5] != null) nodes.push(<code key={`${keyBase}-${k++}`} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] dark:bg-white/10">{m[5]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Render prose that contains [VOCAB] pills inline. Paragraphs without a pill go
// through full Markdown so nothing else (lists, math, links) is lost.
function VocabText({ text }) {
  const paras = String(text).split(/\n{2,}/);
  return (
    <>
      {paras.map((para, pi) => {
        if (!para.trim()) return null;
        const matches = [...para.matchAll(VOCAB_RE)];
        if (!matches.length) return <Markdown key={pi} text={para} />;
        const parts = [];
        let last = 0;
        matches.forEach((mm, mi) => {
          if (mm.index > last) parts.push(...inlineNodes(para.slice(last, mm.index), `t${pi}-${mi}`));
          parts.push(<VocabPill key={`v${pi}-${mi}`} word={mm[1]} definition={mm[2]} />);
          last = mm.index + mm[0].length;
        });
        if (last < para.length) parts.push(...inlineNodes(para.slice(last), `e${pi}`));
        return <p key={pi} className="md my-3 leading-relaxed">{parts}</p>;
      })}
    </>
  );
}

// Choose the renderer for a chunk of prose: inline vocab-aware, or the full
// viz/Markdown pipeline. (A chunk with a code fence always uses the full one.)
function TextBlock({ text, streaming }) {
  if (text.includes("[VOCAB") && !text.includes("```")) return <VocabText text={text} />;
  return <Segments text={text} streaming={streaming} />;
}

function renderCardNode(card, key) {
  return (
    <LessonSegment key={key} type={card.cardType} title={card.title}>
      <TextBlock text={card.body} />
    </LessonSegment>
  );
}

// Diagram tags are self-closing; a stray `</diagram_*>` / `</ShowIsolatedDiagram>`
// the model sometimes adds carries no meaning and must never render as text.
const DIAGRAM_CLOSE_RE = /<\/(?:diagram_(?:sketch|original|cleaned|normalized|isolated)|ShowIsolatedDiagram)\s*>/gi;

// The transcript-side marker left where a <ShowIsolatedDiagram> tag streamed in:
// a subtle chip that re-opens the Visual Context Viewer (useful after scrolling
// or on mobile where the viewer is collapsible).
function ShowDiagramChip({ nodeId, onShowDiagram }) {
  return (
    <button
      onClick={() => onShowDiagram?.(nodeId)}
      title="Show this diagram in the visual viewer"
      className="my-2 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-extrabold text-indigo-600 transition-colors hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
    >
      <span aria-hidden>🖼️</span> Diagram shown in the visual viewer
    </button>
  );
}

export default function RichMessage({ text, streaming = false, className = "", onAnchor, onShowDiagram, onQuizSuccess, persistScope, messageId, progressLogs = [], onLogUpdate }) {
  // On a finished render, auto-close any unclosed block tags so a truncated
  // stream never leaves a stuck "Building your card…" placeholder. Always strip
  // stray diagram closing tags (they're self-closing by contract).
  const safeText = useMemo(
    () => (streaming ? String(text || "") : sanitizeLessonStream(text)).replace(DIAGRAM_CLOSE_RE, ""),
    [text, streaming],
  );
  const hasTags = HAS_TAG.test(safeText);
  const { blocks, anchors, showDiagrams } = useMemo(
    () => (hasTags ? parseInteractive(safeText, streaming) : { blocks: null, anchors: [], showDiagrams: [] }),
    [safeText, hasTags, streaming],
  );

  // Drive the left-pane textbook to the most recent anchor as the message streams.
  const anchorsKey = useMemo(() => JSON.stringify(anchors), [anchors]);
  useEffect(() => {
    if (onAnchor && anchors.length) onAnchor(anchors[anchors.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorsKey]);

  // Stream interception (isolation plan §5.2): as soon as a complete
  // <ShowIsolatedDiagram id/> tag arrives, dispatch the id to the study layout
  // so the sticky Visual Context Viewer displays the isolated asset.
  const showKey = useMemo(() => (showDiagrams || []).join(","), [showDiagrams]);
  useEffect(() => {
    if (onShowDiagram && showDiagrams && showDiagrams.length) {
      onShowDiagram(showDiagrams[showDiagrams.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showKey]);

  // Fast path: no interactive tags → original rendering, unchanged.
  if (!hasTags) {
    return <div className={className}><Segments text={safeText} streaming={streaming} /></div>;
  }

  const lastTextIdx = (() => {
    for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].kind === "text") return i;
    return -1;
  })();

  const nodeFor = (b, i) => {
    switch (b.kind) {
      case "text": return <TextBlock key={i} text={b.text} streaming={streaming && i === lastTextIdx} />;
      case "pending": return <PendingBlock key={i} />;
      case "card": return renderCardNode(b, i);
      case "quiz": {
        const gateId = `gate:${messageId}:${gateHash(b.question, b.options)}`;
        const gateLogs = progressLogs.filter((l) => l.type === "quiz_attempt" && l.target_id === gateId);
        return (
          <ProgressGate key={i} question={b.question} options={b.options} correctAnswer={b.correct}
            correctText={b.correctText} explanation={b.explanation}
            targetId={gateId} sessionId={persistScope} historicalLogs={gateLogs} onLogUpdate={onLogUpdate}
            onCorrectUnlock={() => onQuizSuccess?.({ id: b.id, question: b.question })} />
        );
      }
      case "bento":
        return <BentoGrid key={i} cols={b.cards.length >= 3 ? 3 : 2}>{b.cards.map((c, ci) => renderCardNode(c, `${i}-${ci}`))}</BentoGrid>;
      case "flow": {
        const flowId = `flow:${messageId}:${blockHash(JSON.stringify(b.cards))}`;
        const flowLogs = progressLogs.filter((l) => l.type === "read_continue" && l.target_id === flowId);
        return (
          <LessonProgressiveWrapper key={i}
            targetId={flowId} sessionId={persistScope} historicalLogs={flowLogs} onLogUpdate={onLogUpdate}>
            {b.cards.map((c, ci) => renderCardNode(c, `${i}-${ci}`))}
          </LessonProgressiveWrapper>
        );
      }
      case "streak":
        return <FloatingStreakBadge key={i} streakValue={b.streak} xpGained={b.xp} />;
      case "diagram":
        return <DiagramNode key={i} id={b.nodeId} variant={b.variant} />;
      case "showdiagram":
        return <ShowDiagramChip key={i} nodeId={b.nodeId} onShowDiagram={onShowDiagram} />;
      default: return null;
    }
  };

  // The "Learning Path": when a lesson has several interactive blocks, thread
  // them onto a glowing vertical timeline with a node per step. The
  // showdiagram chip is a marker, not a step — it never counts as a node.
  const interactiveCount = blocks.filter((b) => b.kind !== "text" && b.kind !== "pending" && b.kind !== "showdiagram").length;
  if (interactiveCount >= 2) {
    return (
      <div className={className}>
        <div className="relative">
          <span className="learning-timeline-line absolute bottom-4 left-[6px] top-5 w-0.5 rounded-full" aria-hidden />
          <div className="space-y-1">
            {blocks.map((b, i) => {
              const isNode = b.kind !== "text" && b.kind !== "pending" && b.kind !== "showdiagram";
              return (
                <div key={i} className="relative pl-7">
                  {isNode && <span className="timeline-glow-node absolute left-0 top-[1.4rem] h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" aria-hidden />}
                  {nodeFor(b, i)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return <div className={className}>{blocks.map((b, i) => nodeFor(b, i))}</div>;
}
