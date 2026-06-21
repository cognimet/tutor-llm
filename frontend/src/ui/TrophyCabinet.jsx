import React from "react";
import { Trophy, Lock } from "lucide-react";

/**
 * Senior Mode glassmorphic Trophy Cabinet (spec §5.2). Shows unlocked trophies
 * as 3-D-styled glass cards with rarity tinting, plus locked silhouettes for
 * the rest of the catalogue so students see what's next.
 */

const RARITY = {
  common:     { ring: "ring-amber-200 dark:ring-amber-500/30", grad: "from-amber-100 to-amber-50 dark:from-amber-500/20 dark:to-amber-500/5", label: "Bronze" },
  rare:       { ring: "ring-slate-300 dark:ring-slate-400/30", grad: "from-slate-100 to-white dark:from-slate-400/20 dark:to-slate-400/5", label: "Silver" },
  ultra_rare: { ring: "ring-yellow-300 dark:ring-yellow-400/40", grad: "from-yellow-100 to-amber-50 dark:from-yellow-400/25 dark:to-amber-400/5", label: "Gold" },
};

export default function TrophyCabinet({ trophies = [], catalogue = [], level = 1, rank = "" }) {
  const owned = new Set(trophies.map((t) => t.key));
  // Merge: unlocked first, then any catalogue entries not yet earned (as locked).
  const lockedExtra = catalogue.filter((c) => !owned.has(c.key));

  return (
    <div className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/70">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-white">
          <Trophy className="h-5 w-5 text-amber-500" /> The Champion Cabinet
        </h3>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-extrabold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          Level {level}{rank ? ` · ${rank}` : ""}
        </span>
      </div>

      {trophies.length === 0 && lockedExtra.length === 0 ? (
        <p className="mt-6 text-center text-sm font-semibold text-slate-400">
          No trophies yet — complete a chapter quest to earn your first 🏆
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {trophies.map((t) => {
            const r = RARITY[t.rarity] || RARITY.common;
            return (
              <div key={t.key}
                className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${r.grad} p-4 text-center shadow-md ring-1 ${r.ring} transition-transform hover:-translate-y-1`}>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/70 text-3xl shadow-inner dark:bg-white/10">{t.emoji}</div>
                <p className="mt-2 text-sm font-extrabold text-slate-800 dark:text-white">{t.label}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{r.label}</p>
                {t.description && <p className="mt-1 text-[11px] leading-tight text-slate-500 dark:text-slate-400">{t.description}</p>}
              </div>
            );
          })}
          {lockedExtra.map((c) => (
            <div key={c.key}
              className="relative overflow-hidden rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center dark:border-white/10 dark:bg-white/5">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-300 dark:bg-white/5 dark:text-slate-600">
                <Lock className="h-6 w-6" />
              </div>
              <p className="mt-2 text-sm font-extrabold text-slate-400">{c.label}</p>
              <p className="mt-1 text-[11px] leading-tight text-slate-400">{c.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The full senior trophy catalogue (mirrors GamificationService::TROPHIES) for locked silhouettes. */
export const TROPHY_CATALOGUE = [
  { key: "quest_conqueror", label: "Quest Conqueror", emoji: "🏆", rarity: "common", description: "Complete your first chapter quest" },
  { key: "circuit_wizard", label: "Circuit Wizard", emoji: "🧲", rarity: "rare", description: "Master an electricity quest" },
  { key: "geometry_ninja", label: "Geometry Ninja", emoji: "📐", rarity: "rare", description: "Complete a geometry chapter quest" },
  { key: "atomic_bomber", label: "Atomic Bomber", emoji: "🧪", rarity: "common", description: "Complete a chemistry quest" },
  { key: "plan_champion", label: "Plan Champion", emoji: "🏅", rarity: "ultra_rare", description: "Finish a full study plan" },
];
