import React from "react";
import { ArrowRight, CalendarDays, Target, Layers, ClipboardCheck, Sparkles } from "lucide-react";

/**
 * The single guiding nudge for the learning loop (Learn → Check → Fix →
 * Remember). It looks at what the student has going on and surfaces exactly
 * ONE next action, so they're never left wondering "what now?".
 *
 * Priority: today's plan task → something to fix → cards due → take a check →
 * (fresh) ask a first question. Returns null when there's nothing useful.
 */
export function pickNext(state, handlers) {
  const { planTaskTitle, fixTop, fixCount = 0, dueCards = 0, hasExchange } = state || {};

  if (planTaskTitle) {
    return { icon: CalendarDays, label: `Today's plan: ${planTaskTitle}`, onClick: handlers.onPlan };
  }
  if (fixCount > 0) {
    return {
      icon: Target,
      label: fixTop ? `Fix: ${fixTop}` : `Fix ${fixCount} weak spot${fixCount === 1 ? "" : "s"}`,
      onClick: handlers.onFix,
    };
  }
  if (dueCards > 0) {
    return { icon: Layers, label: `Review ${dueCards} card${dueCards === 1 ? "" : "s"}`, onClick: handlers.onCards };
  }
  if (hasExchange) {
    return { icon: ClipboardCheck, label: "Check your understanding", onClick: handlers.onCheck };
  }
  return { icon: Sparkles, label: "Ask your first question", onClick: handlers.onAsk };
}

const clamp = (s, n = 42) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export default function NextStep({ state, handlers, className = "" }) {
  const next = pickNext(state, handlers);
  if (!next) return null;
  const Icon = next.icon;
  return (
    <button
      onClick={next.onClick}
      className={`group inline-flex max-w-full items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-extrabold text-indigo-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-indigo-500 dark:bg-white/10 dark:text-indigo-300">Next</span>
      <span className="min-w-0 truncate">{clamp(next.label)}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
