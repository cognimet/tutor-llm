import React, { useMemo } from "react";
import Markdown from "./Markdown.jsx";
import Visualization from "./Visualization.jsx";

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
  try {
    const o = JSON.parse(t);
    return !!o && typeof o === "object" && typeof o.type === "string"
      && VIZ_TYPES.has(o.type.toLowerCase());
  } catch {
    return false;
  }
}

function splitSegments(text) {
  const src = String(text || "");
  const segs = [];
  let last = 0;
  let m;
  ANY_FENCE.lastIndex = 0;
  while ((m = ANY_FENCE.exec(src))) {
    const lang = (m[2] || "").trim().toLowerCase();
    const content = m[3];
    const isViz = VIZ_LANGS.has(lang)
      || ((lang === "" || lang === "json" || lang === "json5") && looksLikeVizSpec(content));
    if (!isViz) continue; // leave ordinary code fences inside the Markdown flow
    if (m.index > last) segs.push({ kind: "md", text: src.slice(last, m.index) });
    segs.push({ kind: "viz", code: content.trim() });
    last = m.index + m[0].length;
  }
  const tail = src.slice(last);
  const openAt = tail.search(OPEN_VIZ);
  if (openAt >= 0) {
    // An unterminated viz fence — still streaming in. Show prose before it,
    // then a placeholder until the closing ``` arrives.
    if (openAt > 0) segs.push({ kind: "md", text: tail.slice(0, openAt) });
    segs.push({ kind: "viz-pending" });
  } else if (tail) {
    segs.push({ kind: "md", text: tail });
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

export default function RichMessage({ text, streaming = false, className = "" }) {
  const segments = useMemo(() => splitSegments(text), [text]);
  const lastMdIdx = (() => {
    for (let i = segments.length - 1; i >= 0; i--) if (segments[i].kind === "md") return i;
    return -1;
  })();

  return (
    <div className={className}>
      {segments.map((seg, i) => {
        if (seg.kind === "viz") return <Visualization key={i} code={seg.code} />;
        if (seg.kind === "viz-pending") return <PendingViz key={i} />;
        return (
          <Markdown key={i} text={seg.text} streaming={streaming && i === lastMdIdx} />
        );
      })}
    </div>
  );
}
