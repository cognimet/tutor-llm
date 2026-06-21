import React from "react";
import { BookOpen, Lightbulb, Compass } from "lucide-react";

/**
 * A borderless, typography-first lesson segment (replaces the old boxy
 * LearningCard). The tutor emits [CARD: concept|analogy|vocab title="…"] blocks,
 * which RichMessage parses — and instead of a heavy rounded container, each
 * reads like a friendly storybook page.
 *
 * The labels are written for a 10–12 year old: simple, active, playful action
 * phrases (not clinical "Core Concept / Vocabulary Spot" jargon), each with a
 * one-line kid-friendly subtitle.
 *
 *  - concept  📚  emerald   — "Let's Learn!"   a cool science truth
 *  - analogy  🧩  amber     — "Picture This!"  how it matches everyday life
 *  - vocab    🗣️  indigo    — "Smart Word!"    a word worth knowing
 */
const CONFIGS = {
  concept: {
    label: "📚 Let's Learn!",
    subtitle: "A cool science truth to know",
    icon: BookOpen,
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "text-emerald-500 bg-emerald-50 dark:bg-emerald-500/15",
  },
  analogy: {
    label: "🧩 Picture This!",
    subtitle: "How it matches our everyday life",
    icon: Lightbulb,
    text: "text-amber-600 dark:text-amber-400",
    chip: "text-amber-500 bg-amber-50 dark:bg-amber-500/15",
  },
  vocab: {
    label: "🗣️ Smart Word!",
    subtitle: "Add this word to your vocabulary",
    icon: Compass,
    text: "text-indigo-600 dark:text-indigo-400",
    chip: "text-indigo-500 bg-indigo-50 dark:bg-indigo-500/15",
  },
};

export default function LessonSegment({ type = "concept", title, children }) {
  const cfg = CONFIGS[type] || CONFIGS.concept;
  const Icon = cfg.icon;

  return (
    <div className="msg-in border-b border-slate-100/70 py-5 first:pt-1 last:border-b-0 last:pb-1 dark:border-white/5">
      {/* Playful two-line heading — friendly label + a kid-readable subtitle. */}
      <div className="mb-1.5 flex items-center gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${cfg.chip}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className={`block text-sm font-extrabold uppercase tracking-wider ${cfg.text}`}>
            {cfg.label}
            {title ? <span className="text-slate-700 dark:text-slate-200"> · {title}</span> : null}
          </span>
          <span className="block text-[10px] font-bold text-slate-400">{cfg.subtitle}</span>
        </span>
      </div>

      {/* Borderless body — flows like a storybook page. */}
      <div className="pl-[2.875rem] text-[15px] font-medium leading-relaxed text-slate-700 dark:text-slate-300">
        {children}
      </div>
    </div>
  );
}
