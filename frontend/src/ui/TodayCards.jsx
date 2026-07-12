/**
 * The "Today" ritual: a daily goal ring (the habit anchor) and the spaced-
 * repetition "Review 3" card. Shared by both student homes — the quest map
 * (Classes 1–8) and the subject browser (Class 9+).
 *
 * The goal counts learning WINS (games/quizzes passed at >= 70%), never
 * time-on-app — the server computes it from durable stores.
 */
import React, { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { questApi } from "../api/endpoints.js";

/** SVG progress ring: `done`/`goal` wins today. */
export function DailyGoalRing({ daily }) {
  if (!daily) return null;
  const { done = 0, goal = 3, met = false } = daily;
  const pct = Math.min(1, done / Math.max(1, goal));
  const R = 16, C = 2 * Math.PI * R;

  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
      role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(done, goal)}
      aria-label={`Daily goal: ${done} of ${goal} wins`}>
      <div className="relative grid h-10 w-10 shrink-0 place-items-center">
        <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90">
          <circle cx="20" cy="20" r={R} fill="none" strokeWidth="4" className="stroke-slate-200 dark:stroke-slate-700" />
          <circle cx="20" cy="20" r={R} fill="none" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
            className={`transition-all duration-700 ${met ? "stroke-emerald-500" : "stroke-indigo-500"}`} />
        </svg>
        <span className="absolute text-sm">{met ? "🎉" : "🎯"}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-base font-black text-slate-800 dark:text-slate-100">
          {Math.min(done, goal)}/{goal}{met && done > goal ? ` (+${done - goal})` : ""}
        </div>
        <div className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">
          {met ? "Goal met!" : "Daily goal"}
        </div>
      </div>
    </div>
  );
}

/**
 * "Review 3" — mastered topics the student hasn't touched in a week.
 * `onPlay(item)` decides the destination: a review game (quest mode) or the
 * topic's tutor chat (chat mode). Renders nothing when nothing is due, so it
 * costs no attention on a fresh day.
 */
export function ReviewCard({ onPlay, className = "" }) {
  const [due, setDue] = useState(null); // null = loading, [] = nothing due

  useEffect(() => {
    let alive = true;
    const load = () => questApi.review()
      .then((d) => { if (alive) setDue(d.due || []); })
      .catch(() => { if (alive) setDue([]); });
    load();
    window.addEventListener("progress:refresh", load);
    return () => { alive = false; window.removeEventListener("progress:refresh", load); };
  }, []);

  if (!due?.length) return null;

  return (
    <div className={`rounded-3xl border-2 border-sky-200 bg-sky-50 p-4 dark:border-sky-500/30 dark:bg-sky-500/10 ${className}`}>
      <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-sky-600 dark:text-sky-300">
        <RotateCcw className="h-3.5 w-3.5" /> Keep it fresh
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
        You mastered these a while ago — a quick review makes them stick.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {due.map((d) => (
          <button key={d.topic_id} onClick={() => onPlay(d)}
            className="rounded-2xl border-2 border-b-4 border-sky-300 bg-white px-3.5 py-2 text-left text-sm font-extrabold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 active:translate-y-0.5 active:border-b-2 dark:border-sky-500/40 dark:bg-slate-800 dark:text-slate-200">
            {d.topic_name}
            <span className="ml-1.5 text-[11px] font-bold text-slate-400">{d.days_since}d ago</span>
          </button>
        ))}
      </div>
    </div>
  );
}
