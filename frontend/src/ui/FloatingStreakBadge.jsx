import React from "react";
import { Sparkles } from "lucide-react";

/**
 * Floating combo / streak badge (Fancy Learning spec §5). A glowing, gently
 * wiggling pill that celebrates an active streak and the XP just earned —
 * replaces the old plain-text "Streak multiplier active!".
 */
export function FloatingStreakBadge({ streakValue = 3, xpGained = 20 }) {
  return (
    <div className="animate-wiggle my-3 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 p-0.5 shadow-lg shadow-orange-500/20">
      <div className="flex items-center gap-1.5 rounded-[0.9rem] bg-slate-950/90 px-3 py-1.5 text-xs font-extrabold text-white">
        <span className="text-sm">🔥</span>
        <span>Streak active: {streakValue}x</span>
        <span className="mx-1 h-3 w-px bg-white/20" />
        <span className="flex items-center gap-0.5 text-amber-300">
          +{xpGained} XP <Sparkles className="h-3 w-3 fill-amber-300 text-amber-300" />
        </span>
      </div>
    </div>
  );
}

export default FloatingStreakBadge;
