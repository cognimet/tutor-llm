import React, { useEffect, useRef, useState } from "react";
import { Volume2, HelpCircle } from "lucide-react";

/**
 * Interactive "pop-pill" vocabulary spot (Fancy Learning spec §3). Key academic
 * terms render as a tappable pill that reveals a definition tooltip and can speak
 * the word aloud (Web Speech API). Theme-aware for light/dark.
 */
export default function VocabPill({ word, definition, pronunciationUrl }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close the tooltip on any outside tap (mobile-friendly).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const speak = (e) => {
    e.stopPropagation();
    try {
      if (pronunciationUrl) { new Audio(pronunciationUrl).play(); return; }
      const u = new SpeechSynthesisUtterance(word);
      u.rate = 0.9;
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.speak(u);
    } catch { /* speech unavailable */ }
  };

  return (
    <span className="relative mx-0.5 inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center gap-1 rounded-full border border-indigo-300/60 bg-indigo-50 px-2 py-0.5 text-[0.85em] font-extrabold text-indigo-600 transition-all hover:bg-indigo-100 active:scale-95 dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-300"
      >
        <span>{word}</span>
        <HelpCircle className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <span
          role="tooltip"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="animate-slide-up absolute bottom-full left-1/2 z-50 mb-2 block w-60 max-w-[80vw] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-2xl dark:border-white/10 dark:bg-slate-900"
        >
          <span className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-500">Vocabulary tip</span>
            <button
              type="button"
              onClick={speak}
              title="Hear it"
              className="rounded-md bg-slate-100 p-1 text-slate-500 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20"
            >
              <Volume2 className="h-3 w-3" />
            </button>
          </span>
          <span className="mb-1 block text-xs font-extrabold text-slate-900 dark:text-white">{word}</span>
          <span className="block text-[11px] font-medium leading-relaxed text-slate-500 dark:text-slate-400">{definition}</span>
        </span>
      )}
    </span>
  );
}
