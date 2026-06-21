import React, { useEffect } from "react";
import { Flame, Star, X, Trophy } from "lucide-react";

/**
 * Gamification UI for the "Study from my notes" Quest flow (spec §4.5):
 *  - XpBar:            compact level / XP-progress / streak chip for headers.
 *  - BadgeRow:         the student's unlocked badges.
 *  - CelebrationOverlay: full-screen reward moment (XP gained, level-ups, new
 *                        badges) with confetti, shown after a quest/upload.
 */

/** Compact stats chip. `stats` = { level, rank, xp_into_level, xp_for_level, streak }. */
export function XpBar({ stats, className = "" }) {
  if (!stats) return null;
  const pct = Math.min(100, Math.round((100 * (stats.xp_into_level || 0)) / (stats.xp_for_level || 500)));
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-extrabold text-white shadow">
        L{stats.level}
      </span>
      <div className="min-w-[7rem]">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
          <span className="truncate">{stats.rank}</span>
          <span>{stats.xp_into_level}/{stats.xp_for_level} XP</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {stats.streak > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-extrabold text-amber-600 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
          <Flame className="h-3.5 w-3.5" /> {stats.streak}
        </span>
      )}
    </div>
  );
}

export function BadgeRow({ badges = [], className = "" }) {
  if (!badges.length) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {badges.map((b) => (
        <span key={b.key} title={b.description}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200">
          <span className="text-sm leading-none">{b.emoji}</span> {b.label}
        </span>
      ))}
    </div>
  );
}

const CONFETTI = ["🎉", "✨", "⭐", "🎊", "🌟", "💫"];

/**
 * Full-screen celebration. `reward` = output of GamificationService::award
 * ({ xp_gained, leveled_up, level, new_badges, streak }). Renders nothing if
 * there's no XP and no badges. Auto-dismisses after a few seconds.
 */
export function CelebrationOverlay({ reward, onClose }) {
  const xp = reward?.xp_gained || 0;
  const badges = reward?.new_badges || [];
  const show = xp > 0 || badges.length > 0 || reward?.leveled_up;

  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => onClose?.(), 4200);
    return () => { document.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      {/* confetti */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 16 }).map((_, i) => (
          <span key={i} className="absolute animate-bounce text-2xl"
            style={{ left: `${(i * 6.3) % 100}%`, top: `${(i * 13) % 80}%`, animationDelay: `${(i % 6) * 0.15}s`, animationDuration: `${1 + (i % 4) * 0.3}s` }}>
            {CONFETTI[i % CONFETTI.length]}
          </span>
        ))}
      </div>

      <div className="msg-in relative w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>

        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-3xl shadow-lg shadow-indigo-500/30">
          {reward?.leveled_up ? <Trophy className="h-8 w-8 text-white" /> : <Star className="h-8 w-8 text-white" />}
        </div>

        <h3 className="mt-4 font-display text-2xl font-extrabold text-slate-900 dark:text-white">
          {reward?.leveled_up ? "Level Up!" : "Nice work!"}
        </h3>
        {xp > 0 && <p className="mt-1 text-lg font-extrabold text-indigo-600 dark:text-indigo-300">+{xp} XP</p>}
        {reward?.leveled_up && (
          <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">You reached Level {reward.level} 🎓</p>
        )}
        {reward?.streak > 1 && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-sm font-extrabold text-amber-600 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
            <Flame className="h-4 w-4" /> {reward.streak}-day streak
          </p>
        )}

        {badges.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Badge unlocked</p>
            {badges.map((b) => (
              <div key={b.key} className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2 text-sm font-extrabold text-slate-800 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-100 dark:ring-white/10">
                <span className="text-xl">{b.emoji}</span> {b.label}
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose}
          className="mt-6 w-full rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 px-5 py-3 font-extrabold text-white shadow-lg shadow-indigo-500/30 active:scale-[0.98]">
          Keep going 🚀
        </button>
      </div>
    </div>
  );
}
