import React, { useEffect, useState } from "react";
import { Images, X } from "lucide-react";
import { figuresApi } from "../api/endpoints.js";

/**
 * "Diagrams from your book" — a slim horizontal strip of textbook figures
 * relevant to the current topic/subject. Figures come from a PDF the student
 * (or their teacher) ingested; the AI service read each page with the vision
 * model, so the tutor already teaches from them — this just lets the student
 * SEE the actual diagram. Renders nothing when there are no figures.
 *
 * The image route is auth-gated, so images load through axios (bearer token)
 * as blobs and are shown via object URLs (revoked on unmount).
 */
function FigureImg({ noteId, page, alt, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let alive = true;
    figuresApi
      .image(noteId, page)
      .then((u) => {
        if (alive) {
          url = u;
          setSrc(u);
        } else {
          URL.revokeObjectURL(u);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [noteId, page]);

  if (!src) {
    return <div className={`animate-pulse bg-slate-100 dark:bg-white/5 ${className || ""}`} />;
  }
  return <img src={src} alt={alt} className={className} />;
}

export default function FigureStrip({ ctx }) {
  const [figures, setFigures] = useState([]);
  const [active, setActive] = useState(null); // figure shown enlarged

  const key = `${ctx?.topic_id || ""}|${ctx?.topic_name || ""}|${ctx?.subject_name || ""}`;
  useEffect(() => {
    let alive = true;
    figuresApi
      .list({
        topic_id: ctx?.topic_id || undefined,
        topic_name: ctx?.topic_name || undefined,
        subject_name: ctx?.subject_name || undefined,
        k: 16,
      })
      .then((list) => alive && setFigures(Array.isArray(list) ? list : []))
      .catch(() => alive && setFigures([]));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!figures.length) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6 xl:max-w-4xl 2xl:max-w-5xl">
      <div className="rounded-3xl border border-indigo-100 bg-indigo-50/60 p-3 dark:border-indigo-400/20 dark:bg-indigo-500/10">
        <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-extrabold text-indigo-700 dark:text-indigo-300">
          <Images className="h-3.5 w-3.5" /> Diagrams from your book
          <span className="font-semibold text-indigo-400">· {figures.length}</span>
        </p>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {figures.map((f) => (
            <button
              key={`${f.note_id}-${f.page}`}
              onClick={() => setActive(f)}
              title={f.title}
              className="group w-32 shrink-0 overflow-hidden rounded-2xl border border-white bg-white text-left shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-slate-800"
            >
              <FigureImg
                noteId={f.note_id}
                page={f.page}
                alt={f.title}
                className="h-24 w-full bg-white object-contain"
              />
              <p className="truncate px-2 py-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {f.title}
              </p>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div
          className="msg-in fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm"
          onClick={() => setActive(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-3 dark:border-white/10">
              <p className="px-1 text-sm font-extrabold text-slate-700 dark:text-slate-100">
                {active.title}
                <span className="ml-2 font-semibold text-slate-400">p.{active.page}</span>
              </p>
              <button
                onClick={() => setActive(null)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <FigureImg
                noteId={active.note_id}
                page={active.page}
                alt={active.title}
                className="mx-auto max-h-[60vh] w-auto rounded-xl bg-white object-contain"
              />
              {Array.isArray(active.labels) && active.labels.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {active.labels.map((l, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              )}
              {active.description && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {active.description}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
