import React from "react";
import { Sparkles, Info, BookOpen, Search } from "lucide-react";

/**
 * A themed micro-learning card (Visual Learning spec §2). The tutor emits these
 * as [CARD: concept|analogy|vocab title="…"]…[/CARD] blocks, which RichMessage
 * parses and renders here. Each type has its own colour language so a lesson
 * reads as bite-sized, scannable segments instead of a wall of text.
 *
 *  - concept  📖  emerald   — the solid textbook fact
 *  - analogy  💡  amber     — the playful real-world bridge
 *  - vocab    🔍  indigo    — a technical term spotlighted
 *
 * When the card carries an anchor (page/figure), a "See in textbook" button
 * lets the student jump the left-pane workspace to that spot.
 */
const CONFIGS = {
  concept: {
    border: "border-l-4 border-l-emerald-500 border-slate-100 dark:border-white/5",
    bg: "bg-emerald-50/50 dark:bg-emerald-500/10",
    titleColor: "text-emerald-800 dark:text-emerald-300",
    icon: <BookOpen className="h-4 w-4 text-emerald-500" />,
    fallback: "Core concept",
  },
  analogy: {
    border: "border-l-4 border-l-amber-500 border-slate-100 dark:border-white/5",
    bg: "bg-amber-50/50 dark:bg-amber-500/10",
    titleColor: "text-amber-800 dark:text-amber-300",
    icon: <Sparkles className="h-4 w-4 text-amber-500" />,
    fallback: "Playful analogy",
  },
  vocab: {
    border: "border-l-4 border-l-indigo-500 border-slate-100 dark:border-white/5",
    bg: "bg-indigo-50/50 dark:bg-indigo-500/10",
    titleColor: "text-indigo-800 dark:text-indigo-300",
    icon: <Info className="h-4 w-4 text-indigo-500" />,
    fallback: "Key term",
  },
};

export default function LearningCard({ type = "concept", title, children, onAnchorClick, anchorData }) {
  const cfg = CONFIGS[type] || CONFIGS.concept;

  return (
    <div className={`msg-in my-3 rounded-2xl border p-4 transition-all hover:shadow-md ${cfg.border} ${cfg.bg}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {cfg.icon}
          <span className={`text-xs font-extrabold uppercase tracking-wider ${cfg.titleColor}`}>
            {title || cfg.fallback}
          </span>
        </div>
        {anchorData && (
          <button
            onClick={() => onAnchorClick?.(anchorData)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-extrabold text-slate-500 transition-all hover:text-indigo-500 active:scale-95 dark:border-white/10 dark:bg-slate-800"
          >
            <Search className="h-3 w-3" /> See in textbook{anchorData.page ? ` · p.${anchorData.page}` : ""}
          </button>
        )}
      </div>
      <div className="text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-300">
        {children}
      </div>
    </div>
  );
}
