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

// Tolerant matchers: 3+ backticks (` ``` ` or ```` ```` ````), an optional space
// before the language tag (` ``` viz `), case-insensitive lang, and CRLF line
// endings — all of which Markdown treats as a code fence but a stricter regex
// would miss, leaving the raw JSON on screen. The closing fence must use the
// same run of backticks (`\1`).
const FENCE = /(`{3,})[ \t]*(?:viz|chart|plot|graph)\b[^\n]*\r?\n([\s\S]*?)\1/gi;
const OPEN = /(`{3,})[ \t]*(?:viz|chart|plot|graph)\b[^\n]*\r?\n/i;

function splitSegments(text) {
  const src = String(text || "");
  const segs = [];
  let last = 0;
  let m;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) {
    if (m.index > last) segs.push({ kind: "md", text: src.slice(last, m.index) });
    segs.push({ kind: "viz", code: m[2].trim() });
    last = m.index + m[0].length;
  }
  const tail = src.slice(last);
  const openAt = tail.search(OPEN);
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
