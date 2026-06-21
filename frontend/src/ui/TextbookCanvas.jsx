import React, { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, ZoomIn, ZoomOut, FileText, Loader2, X, Images } from "lucide-react";
import { notesApi, figuresApi } from "../api/endpoints.js";

/**
 * Left-pane "Active Textbook Workspace" (Visual Learning spec §1) — driven by the
 * student's REAL uploaded notes, not a mock. It loads each active note's extracted
 * text and the AI-extracted figure images, lays them out as scrollable pages, and
 * reacts to [VISUAL_ANCHOR] events from the tutor: it scrolls to and flash-
 * highlights the exact phrase the tutor is referring to, and centres the relevant
 * figure. Zoom + fullscreen controls included.
 */

// Auth-gated figure image (loads as a blob with the bearer token, like FigureStrip).
function FigureImg({ noteId, page, alt, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let alive = true;
    figuresApi.image(noteId, page)
      .then((u) => { if (alive) { url = u; setSrc(u); } else URL.revokeObjectURL(u); })
      .catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [noteId, page]);
  if (!src) return <div className={`animate-pulse bg-slate-100 dark:bg-white/5 ${className || ""}`} />;
  return <img src={src} alt={alt} className={className} />;
}

// Split a note's extracted text into display paragraphs (whitespace-normalised,
// capped so a huge PDF doesn't blow up the DOM).
function toParagraphs(text) {
  const clean = String(text || "").replace(/\r/g, "").slice(0, 24000);
  return clean
    .split(/\n{2,}|\n(?=\s*[-•*\d])/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 300);
}

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Render a paragraph, wrapping the first occurrence of `query` in a <mark>.
function HighlightedText({ text, query }) {
  if (!query) return text;
  const q = norm(query);
  const hay = norm(text);
  let idx = hay.indexOf(q);
  // Fall back to the first ~6 words of the phrase if the full phrase isn't found.
  if (idx === -1) {
    const partial = q.split(" ").slice(0, 6).join(" ");
    if (partial.length > 8) idx = hay.indexOf(partial);
  }
  if (idx === -1) return text;
  // Map the normalised index back onto the original string approximately by
  // walking word boundaries — good enough for a visual highlight.
  const words = text.split(/(\s+)/);
  let acc = "";
  let start = -1;
  let consumed = 0;
  for (let i = 0; i < words.length; i++) {
    const before = norm(acc);
    if (start === -1 && before.length >= idx) { start = i; }
    acc += words[i];
    consumed = norm(acc).length;
    if (start !== -1 && consumed >= idx + q.length) {
      return (
        <>
          {words.slice(0, start).join("")}
          <mark className="rounded bg-emerald-200/70 px-0.5 text-emerald-900 dark:bg-emerald-500/40 dark:text-emerald-100">
            {words.slice(start, i + 1).join("")}
          </mark>
          {words.slice(i + 1).join("")}
        </>
      );
    }
  }
  return text;
}

export default function TextbookCanvas({ noteIds = [], subjectName, topicName, topicId, activeAnchor, onClose }) {
  const [notes, setNotes] = useState(null);   // [{id,title,extracted_text}]
  const [figures, setFigures] = useState([]); // [{note_id,page,title,...}]
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [highlight, setHighlight] = useState(null); // { key, n, text }

  const scrollRef = useRef(null);
  const refs = useRef(new Map());               // paragraph/figure key -> element
  const idsKey = (noteIds || []).join(",");

  // Load the active notes' real text.
  useEffect(() => {
    const ids = (noteIds || []).slice(0, 4);
    if (!ids.length) { setNotes([]); return; }
    let alive = true;
    Promise.all(ids.map((id) => notesApi.get(id).catch(() => null)))
      .then((list) => { if (alive) setNotes(list.filter(Boolean)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Load the real AI-extracted figures for this topic/subject.
  useEffect(() => {
    let alive = true;
    figuresApi.list({ topic_id: topicId || undefined, topic_name: topicName || undefined, subject_name: subjectName || undefined, k: 16 })
      .then((list) => { if (alive) setFigures(Array.isArray(list) ? list : []); })
      .catch(() => { if (alive) setFigures([]); });
    return () => { alive = false; };
  }, [topicId, topicName, subjectName]);

  // Group figures by note for inline placement.
  const figuresByNote = useMemo(() => {
    const map = new Map();
    for (const f of figures) {
      if (!map.has(f.note_id)) map.set(f.note_id, []);
      map.get(f.note_id).push(f);
    }
    return map;
  }, [figures]);

  // Pre-split paragraphs per note (memoised).
  const paras = useMemo(() => {
    const m = new Map();
    for (const n of notes || []) m.set(n.id, toParagraphs(n.extracted_text || n.summary || ""));
    return m;
  }, [notes]);

  // React to a new visual anchor: find the matching paragraph (by phrase) or
  // figure (by page), scroll to it, and flash a highlight.
  useEffect(() => {
    if (!activeAnchor || !notes || !notes.length) return;
    const { highlightText, page } = activeAnchor;
    let targetKey = null;

    if (highlightText) {
      const q = norm(highlightText);
      const partial = q.split(" ").slice(0, 6).join(" ");
      outer:
      for (const n of notes) {
        const ps = paras.get(n.id) || [];
        for (let i = 0; i < ps.length; i++) {
          const hay = norm(ps[i]);
          if (hay.includes(q) || (partial.length > 8 && hay.includes(partial))) {
            targetKey = `p:${n.id}:${i}`;
            break outer;
          }
        }
      }
    }
    if (!targetKey && page) {
      for (const n of notes) {
        const figs = figuresByNote.get(n.id) || [];
        if (figs.some((f) => f.page === page)) { targetKey = `f:${n.id}:${page}`; break; }
      }
    }

    if (targetKey) {
      setHighlight({ key: targetKey, n: (highlight?.n || 0) + 1, text: highlightText || "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnchor]);

  // Scroll to the highlighted element once it's (re)rendered.
  useEffect(() => {
    if (!highlight) return;
    const el = refs.current.get(highlight.key);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [highlight]);

  const setRef = (key) => (el) => { if (el) refs.current.set(key, el); };

  return (
    <div className={`flex h-full flex-col bg-slate-100 dark:bg-slate-950 ${isFullscreen ? "fixed inset-0 z-[80]" : ""}`}>
      {/* Control header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 dark:border-white/10 dark:bg-slate-900">
        <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
          <FileText className="h-4 w-4 text-emerald-500" /> Textbook workspace
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.1).toFixed(2)))} title="Zoom out" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"><ZoomOut className="h-4 w-4" /></button>
          <span className="w-10 text-center text-xs font-bold text-slate-500">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))} title="Zoom in" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"><ZoomIn className="h-4 w-4" /></button>
          <div className="mx-1 h-4 w-px bg-slate-200 dark:bg-white/10" />
          <button onClick={() => setIsFullscreen((v) => !v)} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5">
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          {onClose && (
            <button onClick={onClose} title="Close workspace" className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-500 lg:hidden"><X className="h-4 w-4" /></button>
          )}
        </div>
      </div>

      {/* Viewport */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }} className="space-y-5 transition-transform duration-200">
          {notes === null ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-500" /> Opening your textbook…
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm font-bold text-slate-400 dark:border-white/10">
              <FileText className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              No readable note is open in this chat yet.
            </div>
          ) : (
            notes.map((n) => {
              const ps = paras.get(n.id) || [];
              const figs = figuresByNote.get(n.id) || [];
              return (
                <div key={n.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-white/5 dark:bg-slate-900">
                  <h2 className="mb-3 border-b border-slate-100 pb-2 text-base font-extrabold text-slate-900 dark:border-white/10 dark:text-white">{n.title}</h2>

                  {ps.length === 0 ? (
                    <p className="text-xs font-bold text-slate-400">This note has no extracted text to display.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {ps.map((p, i) => {
                        const key = `p:${n.id}:${i}`;
                        const isHi = highlight?.key === key;
                        return (
                          <p
                            key={isHi ? `${key}-${highlight.n}` : key}
                            ref={setRef(key)}
                            className={`text-sm leading-relaxed text-slate-600 dark:text-slate-300 ${isHi ? "anchor-flash px-1" : ""}`}
                          >
                            {isHi ? <HighlightedText text={p} query={highlight.text} /> : p}
                          </p>
                        );
                      })}
                    </div>
                  )}

                  {figs.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        <Images className="h-3.5 w-3.5" /> Diagrams from this note
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {figs.map((f) => {
                          const key = `f:${n.id}:${f.page}`;
                          const isHi = highlight?.key === key;
                          return (
                            <div
                              key={isHi ? `${key}-${highlight.n}` : key}
                              ref={setRef(key)}
                              className={`rounded-xl border bg-white p-2 text-center transition-all dark:bg-slate-800 ${isHi ? "anchor-flash border-emerald-400 ring-4 ring-amber-300/60" : "border-slate-100 dark:border-white/10"}`}
                            >
                              <FigureImg noteId={f.note_id} page={f.page} alt={f.title} className="h-28 w-full rounded-lg bg-white object-contain" />
                              <p className="mt-1 truncate text-[11px] font-bold text-slate-600 dark:text-slate-300">{f.title}</p>
                              <p className="text-[10px] font-bold text-slate-400">p.{f.page}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
