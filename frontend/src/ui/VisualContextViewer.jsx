import React, { useEffect, useState } from "react";
import { ImageOff, X, Wand2, ChevronDown, ChevronUp } from "lucide-react";
import { nodesApi } from "../api/endpoints.js";

/**
 * The "Visual Context Viewer" (Diagram Isolation upgrade §5.1).
 *
 * Opened when the tutor stream emits `<ShowIsolatedDiagram id="…" />`. It shows
 * a SINGLE representation of the student's diagram: the "idealised render" — a
 * clean, labelled textbook illustration a Gemini image model generated from the
 * isolated drawing. If that asset isn't present it quietly falls back to the
 * isolated crop, so the pane is never empty. No interactive / raw-drawing
 * toggles — illustration-only keeps the UI simple and saves tokens (the
 * interactive UVSS reconstruction is disabled server-side by default).
 */

// Pick the best image variant to display: the generated illustration first,
// then the isolated cut, then any other crop the node actually has.
function pickVariant(meta) {
  const imgs = meta?.images || [];
  for (const v of ["illustrated", "isolated", "cleaned", "original", "normalized"]) {
    if (imgs.includes(v)) return v;
  }
  if (meta?.has_illustrated) return "illustrated";
  if (meta?.has_isolated) return "isolated";
  return imgs[0] || null;
}

export default function VisualContextViewer({ nodeId, onClose, compact = false }) {
  const [meta, setMeta] = useState(null);
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [noImage, setNoImage] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let url = null;
    let alive = true;
    setMeta(null); setSrc(null); setFailed(false); setNoImage(false); setCollapsed(false);
    if (!nodeId) return undefined;

    nodesApi
      .schema(nodeId)
      .then((d) => {
        if (!alive) return;
        setMeta(d);
        const variant = pickVariant(d);
        if (!variant) { setNoImage(true); return; }
        return nodesApi
          .image(nodeId, variant)
          .then((u) => { if (alive) { url = u; setSrc(u); } else URL.revokeObjectURL(u); });
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [nodeId]);

  if (!nodeId) return null;

  const labels = (meta?.labels || []).slice(0, 10);
  const isIllustration = !!(meta && (meta.has_illustrated || (meta.images || []).includes("illustrated")));

  return (
    <div className={`flex flex-col overflow-hidden rounded-3xl border border-indigo-100 bg-white shadow-lg shadow-indigo-100/50 dark:border-indigo-500/20 dark:bg-slate-900 dark:shadow-none ${compact ? "" : "h-full"}`}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-indigo-50/80 to-violet-50/60 px-3 py-2 dark:border-white/10 dark:from-indigo-500/10 dark:to-violet-500/10">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
          <Wand2 className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-extrabold text-slate-800 dark:text-white">{meta?.title || "Your diagram"}</p>
          <p className="truncate text-[10px] font-bold uppercase tracking-wide text-indigo-400">
            {isIllustration ? "Textbook illustration from your notes" : "From your notes"}
          </p>
        </div>
        {compact && (
          <button onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Show the diagram" : "Minimise"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/60 hover:text-indigo-600 dark:hover:bg-white/10">
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        )}
        <button onClick={onClose} title="Close the visual viewer"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/60 hover:text-rose-500 dark:hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body — the illustration (or crop fallback) */}
      {!collapsed && (
        <div className={`flex min-h-0 flex-1 flex-col ${compact ? "" : "overflow-y-auto"}`}>
          <div className={`grid place-items-center bg-white p-3 dark:bg-slate-800 ${compact ? "max-h-56" : ""}`}>
            {noImage ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                <ImageOff className="h-5 w-5 text-slate-400" />
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">No illustration for this diagram yet.</p>
                <p className="text-[11px] text-slate-400">Re-process this note to generate it.</p>
              </div>
            ) : failed ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                <ImageOff className="h-5 w-5 text-slate-400" />
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Illustration couldn’t be loaded.</p>
                <p className="text-[11px] text-slate-400">Re-process the note to regenerate it.</p>
              </div>
            ) : !src ? (
              <div className={`w-full animate-pulse rounded-2xl bg-slate-100 dark:bg-white/5 ${compact ? "h-40" : "h-64"}`} />
            ) : (
              <img src={src} alt={meta?.title || "Diagram illustration from your notes"}
                className={`w-auto max-w-full object-contain ${compact ? "max-h-52" : "max-h-[56vh]"}`} />
            )}
          </div>

          {labels.length > 0 && !compact && (
            <div className="border-t border-slate-100 px-3 py-2.5 dark:border-white/10">
              <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Labels in this diagram</p>
              <div className="flex flex-wrap gap-1">
                {labels.map((l) => (
                  <span key={l} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">{l}</span>
                ))}
              </div>
            </div>
          )}

          {!compact && (
            <p className="mt-auto border-t border-slate-100 px-3 py-2 text-[10px] font-semibold leading-relaxed text-slate-400 dark:border-white/10">
              A clean textbook illustration rebuilt from your drawing — keep an eye here while you read.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
