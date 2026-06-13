import React, { useEffect, useState } from "react";
import {
  Loader2, Clock, Target, ClipboardCheck, BookOpen, Brain, Lightbulb,
  TrendingUp, AlertTriangle, Sparkles,
} from "lucide-react";
import { profileApi } from "../api/endpoints.js";

/**
 * The learner's "current stage" dashboard — a colourful, at-a-glance read of
 * where the student is: stage + score, time, accuracy, critical thinking,
 * per-topic mastery, why they're getting things wrong, and AI suggestions.
 * Backed by GET /tutor/profile.
 */
const STAGE = {
  emerald: { ring: "#10b981", grad: "from-emerald-500 to-teal-500", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  violet:  { ring: "#8b5cf6", grad: "from-violet-500 to-fuchsia-500", chip: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  indigo:  { ring: "#6366f1", grad: "from-indigo-500 to-violet-500", chip: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" },
  sky:     { ring: "#0ea5e9", grad: "from-sky-500 to-indigo-500", chip: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  slate:   { ring: "#64748b", grad: "from-slate-500 to-slate-600", chip: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300" },
};
const barColor = (v) => (v >= 70 ? "bg-emerald-500" : v >= 40 ? "bg-amber-500" : "bg-rose-500");

function Ring({ score, color }) {
  const r = 34, c = 2 * Math.PI * r, dash = Math.max(0, Math.min(100, score)) / 100 * c;
  return (
    <svg viewBox="0 0 80 80" className="h-20 w-20 shrink-0 -rotate-90">
      <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-200 dark:text-white/10" />
      <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`} />
      <text x="40" y="40" transform="rotate(90 40 40)" textAnchor="middle" dominantBaseline="central"
        className="fill-slate-800 dark:fill-white" style={{ fontSize: 18, fontWeight: 800 }}>{score}</text>
    </svg>
  );
}

const Stat = ({ icon: Icon, label, value, tint }) => (
  <div className="flex items-center gap-2.5 rounded-2xl border border-slate-100 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-slate-800">
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tint}`}><Icon className="h-4 w-4" /></span>
    <div className="min-w-0">
      <p className="text-sm font-extrabold leading-tight text-slate-800 dark:text-slate-100">{value}</p>
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  </div>
);

// Render **bold** segments in a suggestion string.
function Rich({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
    seg.startsWith("**") && seg.endsWith("**")
      ? <b key={i} className="text-slate-800 dark:text-slate-100">{seg.slice(2, -2)}</b>
      : <span key={i}>{seg}</span>);
}

export default function LearnerStage() {
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    profileApi.get().then((d) => { if (alive) setP(d); }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-sm font-bold text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-400" /> Reading your progress…
      </div>
    );
  }
  if (!p) return null;

  const s = STAGE[p.stage?.color] || STAGE.slate;
  const t = p.totals || {};
  const ct = p.critical_thinking || {};

  return (
    <div className="space-y-5">
      {/* Stage hero */}
      <div className={`flex items-center gap-4 rounded-3xl bg-gradient-to-br ${s.grad} p-5 text-white shadow-md`}>
        <div className="rounded-full bg-white/15 p-1">
          <div className="rounded-full bg-white/90 dark:bg-slate-900/80"><Ring score={p.stage?.score ?? 0} color={s.ring} /></div>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/80">Your stage</p>
          <p className="font-display text-2xl font-extrabold leading-tight">{p.stage?.label}</p>
          {p.focus?.topic && (
            <p className="mt-1 truncate text-xs text-white/90">
              Next focus: <b>{p.focus.concept ? `${p.focus.concept} · ${p.focus.topic}` : p.focus.topic}</b>
            </p>
          )}
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={Clock} label="Time studied" value={`${t.active_minutes ?? 0}m`} tint="bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" />
        <Stat icon={Target} label="Accuracy" value={`${t.accuracy_pct ?? 0}%`} tint="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" />
        <Stat icon={ClipboardCheck} label="Checks" value={t.assessments ?? 0} tint="bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" />
        <Stat icon={BookOpen} label="Topics" value={t.topics ?? 0} tint="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" />
      </div>

      {/* Right vs wrong + critical thinking */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 dark:border-white/10 dark:bg-slate-800">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-400"><TrendingUp className="h-3.5 w-3.5" /> Right vs wrong</p>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
            <div className="bg-emerald-500" style={{ width: `${t.questions_answered ? (t.correct / t.questions_answered) * 100 : 0}%` }} />
            <div className="bg-rose-400" style={{ width: `${t.questions_answered ? (t.wrong / t.questions_answered) * 100 : 0}%` }} />
          </div>
          <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            <span className="text-emerald-600 dark:text-emerald-400">{t.correct ?? 0} right</span> · <span className="text-rose-500">{t.wrong ?? 0} wrong</span>
          </p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 dark:border-white/10 dark:bg-slate-800">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-400"><Brain className="h-3.5 w-3.5" /> Critical thinking</p>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
            <div className={barColor(ct.score ?? 0)} style={{ height: "100%", width: `${ct.score ?? 0}%` }} />
          </div>
          <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">{ct.label || "—"} ({ct.score ?? 0}/100)</p>
        </div>
      </div>

      {/* Per-topic mastery */}
      {p.per_topic?.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-400"><BookOpen className="h-3.5 w-3.5" /> Mastery by topic</p>
          <div className="space-y-2">
            {p.per_topic.map((row) => (
              <div key={row.topic} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-xs font-bold text-slate-600 dark:text-slate-300">{row.topic}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div className={`h-full rounded-full ${barColor(row.mastery)}`} style={{ width: `${Math.max(3, row.mastery)}%` }} />
                </div>
                <span className="w-9 shrink-0 text-right text-[11px] font-extrabold text-slate-500 dark:text-slate-400">{row.mastery}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Why you're getting things wrong */}
      {p.why_wrong?.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-400"><AlertTriangle className="h-3.5 w-3.5" /> Where you slip most</p>
          <div className="flex flex-wrap gap-2">
            {p.why_wrong.map((w) => (
              <span key={w.concept} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-extrabold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                {w.concept} <span className="rounded-full bg-rose-200/60 px-1.5 dark:bg-rose-500/30">{w.misses}×</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {p.suggestions?.length > 0 && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-indigo-500"><Lightbulb className="h-3.5 w-3.5" /> Coach suggestions</p>
          <ul className="space-y-2">
            {p.suggestions.map((sug, i) => (
              <li key={i} className="flex items-start gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" /> <span><Rich text={sug} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
