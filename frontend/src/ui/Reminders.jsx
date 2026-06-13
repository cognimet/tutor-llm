import React, { useEffect, useState } from "react";
import {
  CalendarClock, Target, Layers, AlertTriangle, Sparkles, Loader2,
  Sun, Sunrise, BookOpen, Repeat, ClipboardCheck,
} from "lucide-react";
import { remindersApi } from "../api/endpoints.js";

/**
 * In-app Plan Reminders feed: the student's "what now?" at a glance — their
 * single next focus, exam countdowns, and what's due today / tomorrow / overdue,
 * across every topic. Backed by GET /tutor/reminders (server-computed, same
 * priority as the NextStep pill). Self-fetching; safe to drop anywhere.
 */
const KIND = {
  learn:    { icon: BookOpen,        cls: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" },
  practice: { icon: Target,          cls: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" },
  revise:   { icon: Repeat,          cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" },
  assess:   { icon: ClipboardCheck,  cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" },
};

function TaskRow({ t }) {
  const k = KIND[t.kind] || KIND.learn;
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-slate-100 bg-white px-3 py-2 dark:border-white/10 dark:bg-slate-800">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg ${k.cls}`}>
        <k.icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{t.title}</p>
        <p className="truncate text-[11px] font-bold text-slate-400">
          {t.topic}{t.estimated_minutes ? ` · ~${t.estimated_minutes} min` : ""}{t.concept ? ` · ${t.concept}` : ""}
        </p>
      </div>
    </div>
  );
}

function Section({ icon: Icon, label, tint, tasks }) {
  if (!tasks?.length) return null;
  return (
    <div>
      <p className={`mb-1.5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest ${tint}`}>
        <Icon className="h-3.5 w-3.5" /> {label} · {tasks.length}
      </p>
      <div className="space-y-1.5">{tasks.map((t) => <TaskRow key={t.task_id} t={t} />)}</div>
    </div>
  );
}

export default function Reminders({ grad = "from-indigo-500 to-violet-500", onReload }) {
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    remindersApi.feed()
      .then((d) => { if (alive) setFeed(d); })
      .catch(() => { /* graph/feed optional — never block the screen */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReload]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-400 dark:border-white/10 dark:bg-slate-800/60">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-400" /> Loading your reminders…
      </div>
    );
  }
  if (!feed) return null;

  const { today = [], tomorrow = [], overdue = [], exams = [], due_cards = 0, fix = {}, focus, next } = feed;
  const nothing = !today.length && !tomorrow.length && !overdue.length && !exams.length && !due_cards && !(fix?.count);

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-800/60">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <CalendarClock className="h-4 w-4" />
        </span>
        <p className="text-sm font-extrabold text-slate-900 dark:text-white">Reminders</p>
        {next?.label && (
          <span className="ml-auto inline-flex max-w-[55%] items-center gap-1 truncate rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-extrabold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Sparkles className="h-3 w-3 shrink-0" /> <span className="truncate">{next.label}</span>
          </span>
        )}
      </div>

      {/* Single next focused area */}
      {focus?.topic && (
        <div className={`flex items-center gap-3 rounded-2xl bg-gradient-to-br ${grad} px-4 py-3 text-white shadow-md`}>
          <Target className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-white/80">Next focus</p>
            <p className="truncate text-sm font-extrabold">
              {focus.concept ? `${focus.concept} · ${focus.topic}` : focus.topic}
            </p>
            {focus.reason && <p className="truncate text-[11px] text-white/85">{focus.reason}</p>}
          </div>
        </div>
      )}

      {/* Exam countdowns (all topics) */}
      {exams.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {exams.map((e) => (
            <span key={e.plan_id}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-extrabold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
              <CalendarClock className="h-3.5 w-3.5" />
              {e.topic}: {e.days_remaining === 0 ? "exam today!" : `${e.days_remaining} day${e.days_remaining === 1 ? "" : "s"} left`}
            </span>
          ))}
        </div>
      )}

      <Section icon={AlertTriangle} label="Overdue" tint="text-rose-500" tasks={overdue} />
      <Section icon={Sun}     label="Today"    tint="text-indigo-500" tasks={today} />
      <Section icon={Sunrise} label="Tomorrow" tint="text-slate-400"  tasks={tomorrow} />

      {/* Footer glance: cards due + fix queue */}
      {(due_cards > 0 || fix?.count > 0) && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
          {due_cards > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-extrabold text-slate-600 dark:bg-white/10 dark:text-slate-300">
              <Layers className="h-3.5 w-3.5" /> {due_cards} card{due_cards === 1 ? "" : "s"} due
            </span>
          )}
          {fix?.count > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-extrabold text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
              <Target className="h-3.5 w-3.5" /> {fix.count} to fix{fix.top ? `: ${String(fix.top).slice(0, 28)}` : ""}
            </span>
          )}
        </div>
      )}

      {nothing && (
        <p className="py-2 text-center text-xs font-bold text-slate-400">
          You're all caught up — no reminders right now. Build a plan or ask your tutor a question.
        </p>
      )}
    </div>
  );
}
