import React from "react";
import { ArrowLeft, Check, ListChecks, Clock, BookOpen, Sparkles, Play, ClipboardCheck } from "lucide-react";
import { Card, Button } from "../../ui/components.jsx";

// Persistent "Light next-steps" surface: every active plan the AI built from
// the student's gaps, grouped by topic, with check-off that survives reloads.
export default function StudentPlans({ plans = [], onBack, onToggleItem, onStartTask }) {
  const active = plans.filter((p) => (p.items || []).length > 0);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 hover:text-indigo-600">
        <ArrowLeft className="h-4 w-4" /> Home
      </button>

      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-3xl bg-indigo-50 text-indigo-600"><ListChecks className="h-6 w-6" /></span>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Your next steps</h1>
          <p className="text-slate-500">Short, focused tasks the AI built from the gaps it found. Check them off as you go.</p>
        </div>
      </div>

      {active.length === 0 ? (
        <Card className="mt-8 p-10 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-3xl">🎯</div>
          <h2 className="mt-4 text-xl font-extrabold tracking-tight text-slate-900">No next steps yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-slate-500">
            Take a mini-assessment inside any tutor chat — when the AI spots a gap, it builds a plan and it’ll show up here.
          </p>
          <Button onClick={onBack} className="mt-6">Back to topics</Button>
        </Card>
      ) : (
        <div className="mt-8 space-y-6">
          {active.map((plan) => <PlanCard key={plan.id} plan={plan} onToggleItem={onToggleItem} onStartTask={onStartTask} />)}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, onToggleItem, onStartTask }) {
  const items = plan.items || [];
  const done = items.filter((i) => i.status === "done").length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const complete = done === items.length;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-lg font-extrabold text-slate-900">
            <Sparkles className="h-4 w-4 text-indigo-500" /> {plan.title}
          </p>
          {plan.topic_name && (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <BookOpen className="h-3.5 w-3.5" /> {plan.topic_name}
            </p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ${complete ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50 text-indigo-600"}`}>
          {done}/{items.length} done
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${complete ? "bg-emerald-500" : "bg-gradient-to-r from-indigo-500 to-violet-500"}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-4 space-y-2">
        {items.map((item) => {
          const isQuiz = /\b(quiz|re-?take|assessment|test|mock)\b/i.test(item.title || "");
          return (
            <div key={item.id}
              className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 transition-all hover:border-indigo-200">
              {/* Circle toggles done/undone */}
              <button onClick={() => onToggleItem(item)} title={item.status === "done" ? "Mark as not done" : "Mark as done"}
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors ${item.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 hover:border-indigo-400"}`}>
                {item.status === "done" && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </button>
              {/* Body starts the task (auto-delivered by the tutor / opens the quiz) */}
              <button onClick={() => onStartTask?.(item, plan.topic_name)} className="flex-1 text-left">
                <p className={`text-sm font-extrabold ${item.status === "done" ? "text-slate-400 line-through" : "text-slate-800"}`}>{item.title}</p>
                {item.detail && <p className="text-xs text-slate-500">{item.detail}</p>}
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-400">
                  <Clock className="h-3 w-3" /> ~{item.estimated_minutes} min{item.concept ? ` · ${item.concept}` : ""}
                </p>
              </button>
              {/* Explicit start affordance */}
              <button onClick={() => onStartTask?.(item, plan.topic_name)}
                className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-extrabold text-indigo-600 transition-colors hover:bg-indigo-500 hover:text-white">
                {isQuiz ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isQuiz ? "Quiz" : "Start"}
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
