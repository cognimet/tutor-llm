import React from "react";
import { Brain, AlertTriangle, CheckCircle2, Compass, Sparkles } from "lucide-react";

/**
 * The "shows its mind" panel (Chat Page Spec §6) — the trust differentiator.
 * Live concept mastery (EWMA), misconceptions caught as they happen
 * (open → fixed), what the tutor remembers about the student, and the
 * recommended next step. Refreshed via the `mind` SSE event after each turn.
 */

function MasteryBar({ concept, score, passes }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-600">{concept}</span>
        <span className={`text-[11px] font-extrabold ${passes ? "text-emerald-600" : "text-slate-400"}`}>
          {score}%{passes && " ✓"}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            passes ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
              : score >= 50 ? "bg-gradient-to-r from-indigo-400 to-violet-500"
              : "bg-gradient-to-r from-amber-400 to-orange-400"
          }`}
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </div>
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <div className="rounded-3xl border border-white/60 bg-white/75 p-4 shadow-sm backdrop-blur-sm">
      <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
        {icon} {title}
      </p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

export default function TutorMind({ mind }) {
  if (!mind) {
    return (
      <div className="rounded-3xl border border-white/60 bg-white/60 p-5 text-center text-xs font-bold text-slate-400 backdrop-blur-sm">
        <Brain className="mx-auto mb-2 h-5 w-5 text-indigo-300" />
        The tutor’s live read on you appears here as you chat.
      </div>
    );
  }

  const open = (mind.misconceptions || []).filter((m) => m.status === "open");
  const resolved = (mind.misconceptions || []).filter((m) => m.status === "resolved");
  const composite = mind.composite_mastery ?? 0;
  const memory = Object.entries(mind.memory || {});

  return (
    <div className="space-y-3">
      {/* Live mastery */}
      <Section icon={<Brain className="h-3.5 w-3.5 text-indigo-500" />} title="Live mastery">
        <div className="flex items-center gap-3">
          <div className="relative grid h-14 w-14 shrink-0 place-items-center">
            <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" strokeWidth="4" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                stroke={mind.topic_mastered ? "#10b981" : "#6366f1"}
                strokeWidth="4" strokeLinecap="round"
                strokeDasharray={`${(composite / 100) * 97.4} 97.4`}
                className="transition-all duration-700"
              />
            </svg>
            <span className="absolute text-sm font-extrabold text-slate-800">{composite}%</span>
          </div>
          <p className="min-w-0 text-[11px] font-bold leading-snug text-slate-400">
            {mind.topic_mastered
              ? "Every concept passed — topic mastered! 🎉"
              : "Topic is mastered when every concept passes 80% — never an average."}
          </p>
        </div>
        {(mind.concepts || []).length > 0 ? (
          <div className="mt-3 space-y-2.5">
            {mind.concepts.map((c) => (
              <MasteryBar key={c.concept} concept={c.concept} score={c.score} passes={c.passes} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] font-bold text-slate-400">
            Chat or take a quick check — concept scores appear live.
          </p>
        )}
      </Section>

      {/* Misconceptions: caught live, open → fixed */}
      <Section icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />} title="Misconceptions">
        {open.length === 0 && resolved.length === 0 ? (
          <p className="text-[11px] font-bold text-slate-400">
            None spotted yet — they’ll be flagged here the moment one shows up.
          </p>
        ) : (
          <div className="space-y-1.5">
            {open.map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-xl bg-amber-50 px-2.5 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="text-[11px] font-bold leading-snug text-amber-800">{m.description}</span>
              </div>
            ))}
            {resolved.map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-xl bg-emerald-50/70 px-2.5 py-2 opacity-80">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span className="text-[11px] font-bold leading-snug text-emerald-700 line-through decoration-emerald-300">
                  {m.description}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Cross-session memory */}
      <Section icon={<Sparkles className="h-3.5 w-3.5 text-violet-500" />} title="Tutor remembers">
        {memory.length === 0 ? (
          <p className="text-[11px] font-bold text-slate-400">Still getting to know you.</p>
        ) : (
          <div className="space-y-1">
            {memory.slice(0, 8).map(([k, v]) => (
              <p key={k} className="text-[11px] font-bold text-slate-500">
                <span className="capitalize text-slate-400">{k.replace(/_/g, " ")}:</span> {String(v)}
              </p>
            ))}
          </div>
        )}
      </Section>

      {/* Next step */}
      {mind.next_step && (
        <Section icon={<Compass className="h-3.5 w-3.5 text-sky-500" />} title="Next step">
          <p className="text-[11px] font-bold leading-relaxed text-slate-600">{mind.next_step}</p>
        </Section>
      )}
    </div>
  );
}
