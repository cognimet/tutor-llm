import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  X, CalendarDays, FileText, Layers, AlertTriangle, Upload, Loader2,
  Check, RefreshCw, Sparkles, Trash2, ClipboardCheck, RotateCcw,
  BookOpen, Target, Repeat, PenLine, ChevronRight, CalendarClock, Activity,
} from "lucide-react";
import { notesApi, plannerApi, flashcardsApi, mistakesApi, telemetryApi } from "../api/endpoints.js";
import { NoteIcon, fmtBytes } from "./NotesPicker.jsx";
import TutorMind from "../screens/student/TutorMind.jsx";
import Reminders from "./Reminders.jsx";
import LearnerStage from "./LearnerStage.jsx";

/* ----------------------------------------------------------------- dates */
const MS_DAY = 86400000;
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - startOfToday().getTime()) / MS_DAY);
}
function dayLabel(dateStr) {
  const n = daysUntil(dateStr);
  if (n === null) return "";
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return new Date(dateStr).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const KIND = {
  learn:    { icon: BookOpen, label: "Learn",    cls: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" },
  practice: { icon: Target,   label: "Practice", cls: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" },
  revise:   { icon: Repeat,   label: "Revise",   cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" },
  assess:   { icon: ClipboardCheck, label: "Assess", cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" },
};

const TABS = [
  ["plan", "Plan", CalendarDays],
  ["fix", "What to work on", Target],
  ["notes", "Notes", FileText],
  ["cards", "Cards", Layers],
  ["me", "Me", Activity],
];

/* ================================================================== shell */
export default function StudyHub({ ctx, grad, initialTab = "plan", mind, onClose, onBigAssessment, onReExplain }) {
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Engagement telemetry: which Study-hub panel the student opens (feeds the
  // learner stage — "is the student using our tools?").
  useEffect(() => {
    telemetryApi.send([{ type: "panel_open", topic_name: ctx.topic_name, topic_id: ctx.topic_id, meta: { tab } }]);
  }, [tab, ctx.topic_name, ctx.topic_id]);

  return (
    <div className="msg-in fixed inset-0 z-[60] flex flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex items-center gap-3 border-b border-slate-200/60 px-4 py-3 dark:border-white/10">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${grad} text-white shadow-sm`}>
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">Study hub</p>
          <p className="truncate text-[11px] font-bold text-slate-400">{ctx.topic_name}</p>
        </div>
        <button onClick={onClose} title="Close (Esc)"
          className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-slate-900 dark:text-slate-300 dark:ring-white/10 dark:hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex justify-center gap-1 border-b border-slate-200/60 px-3 py-2 dark:border-white/10">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-extrabold transition-colors ${
              tab === id ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5"
            }`}>
            <Icon className="h-4 w-4" /> <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {tab === "plan" && <PlanTab ctx={ctx} grad={grad} onBigAssessment={onBigAssessment} />}
          {tab === "fix" && <FixTab ctx={ctx} mind={mind} onReExplain={onReExplain} />}
          {tab === "notes" && <NotesTab ctx={ctx} grad={grad} />}
          {tab === "cards" && <FlashcardsTab ctx={ctx} grad={grad} />}
          {tab === "me" && <LearnerStage />}
        </div>
      </div>
    </div>
  );
}

/* =================================================================== plan */
const HORIZONS = [
  ["day", "Today", "☀️"],
  ["week", "This week", "📅"],
  ["month", "This month", "🗓️"],
  ["exam", "Exam", "🎯"],
];

function PlanTab({ ctx, grad, onBigAssessment }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [horizon, setHorizon] = useState("week");
  const [examDate, setExamDate] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  const params = ctx.topic_id ? { topic_id: ctx.topic_id } : { topic_name: ctx.topic_name };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await plannerApi.index(params);
      setPlans(data.plans || []);
      setShowForm((data.plans || []).length === 0);
    } catch { /* ignore */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.topic_id, ctx.topic_name]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setError(""); setBusy(true);
    try {
      await plannerApi.generate({
        topic_id: ctx.topic_id, topic_name: ctx.topic_name,
        chapter_name: ctx.chapter_name, subject_name: ctx.subject_name,
        horizon, exam_date: horizon === "exam" ? examDate : undefined,
      });
      await load();
      setShowForm(false);
    } catch (err) {
      setError(err?.response?.data?.message
        || (err?.response?.status === 422 ? "Pick a valid exam date in the future." : "Couldn't build the plan. Try again."));
    } finally { setBusy(false); }
  };

  const replan = async (plan) => {
    setBusy(true);
    try { await plannerApi.replan(plan.id); await load(); } catch { /* */ } finally { setBusy(false); }
  };

  const toggle = async (plan, task) => {
    const updated = await plannerApi.toggleTask(task.id);
    setPlans((ps) => ps.map((p) => p.id !== plan.id ? p
      : { ...p, tasks: p.tasks.map((t) => t.id === task.id ? updated : t) }));
  };

  if (loading) return <Loading label="Loading your plan…" />;

  return (
    <div className="space-y-5">
      {/* In-app Plan Reminders: next focus + exam countdowns + today/tomorrow/
          overdue across every topic (re-fetches whenever this topic's plans change). */}
      <Reminders grad={grad} onReload={plans.length} />

      {/* Exam countdown */}
      {(() => {
        const exam = plans.map((p) => p.exam_date).filter(Boolean).sort()[0];
        const n = daysUntil(exam);
        if (n === null) return null;
        return (
          <div className={`flex items-center gap-3 rounded-2xl bg-gradient-to-br ${grad} px-4 py-3 text-white shadow-md`}>
            <CalendarClock className="h-6 w-6 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-white/80">Exam countdown</p>
              <p className="font-display text-xl font-extrabold">
                {n > 0 ? `${n} day${n === 1 ? "" : "s"} to go` : n === 0 ? "Exam is today — you've got this!" : "Exam passed"}
              </p>
            </div>
          </div>
        );
      })()}

      {/* New-plan form */}
      {showForm ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-800/60">
          <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">Build a study plan</p>
          <p className="mt-0.5 text-xs text-slate-400">Built from your notes, your gaps and what you've mastered.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {HORIZONS.map(([id, label, emoji]) => (
              <button key={id} onClick={() => setHorizon(id)}
                className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-extrabold transition-all ${
                  horizon === id ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                    : "border-slate-200 text-slate-500 hover:border-indigo-200 dark:border-white/10 dark:text-slate-300"
                }`}>
                <span className="text-lg">{emoji}</span> {label}
              </button>
            ))}
          </div>
          {horizon === "exam" && (
            <div className="mt-3">
              <label className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Exam date</label>
              <input type="date" value={examDate} min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setExamDate(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200" />
            </div>
          )}
          {error && <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>}
          <button onClick={generate} disabled={busy || (horizon === "exam" && !examDate)}
            className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${grad} px-4 py-2.5 text-sm font-extrabold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-40`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? "Building your plan…" : "Generate plan"}
          </button>
          {plans.length > 0 && (
            <button onClick={() => setShowForm(false)} className="mt-2 w-full text-center text-xs font-bold text-slate-400 hover:text-indigo-600">Cancel</button>
          )}
        </div>
      ) : (
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-600 transition-all hover:border-indigo-300 hover:text-indigo-600 dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-300">
          <Sparkles className="h-3.5 w-3.5" /> New plan
        </button>
      )}

      {/* Active plans */}
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} grad={grad} busy={busy}
          onToggle={(t) => toggle(plan, t)} onReplan={() => replan(plan)} onBigAssessment={onBigAssessment} />
      ))}
    </div>
  );
}

function PlanCard({ plan, grad, busy, onToggle, onReplan, onBigAssessment }) {
  // Group tasks by scheduled date.
  const groups = {};
  for (const t of plan.tasks || []) {
    const key = t.scheduled_for || "—";
    (groups[key] ||= []).push(t);
  }
  const dates = Object.keys(groups).sort();
  const done = (plan.tasks || []).filter((t) => t.status === "done").length;
  const total = (plan.tasks || []).length;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-800/60">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{plan.title}</p>
          {plan.meta?.summary && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{plan.meta.summary}</p>}
          <p className="mt-1 text-[11px] font-bold text-indigo-400">{done}/{total} done</p>
        </div>
        <button onClick={onReplan} disabled={busy} title="Re-plan remaining tasks"
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-extrabold text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40 dark:border-white/10 dark:text-slate-300">
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Re-plan
        </button>
      </div>

      <div className="mt-3 space-y-4">
        {dates.map((d) => (
          <div key={d}>
            <p className="mb-1.5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
              <CalendarDays className="h-3.5 w-3.5" /> {d === "—" ? "Anytime" : dayLabel(d)}
            </p>
            <div className="space-y-1.5">
              {groups[d].map((t) => {
                const k = KIND[t.kind] || KIND.learn;
                const isDone = t.status === "done";
                return (
                  <div key={t.id} className="flex items-start gap-2.5 rounded-2xl border border-slate-100 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-slate-800">
                    <button onClick={() => onToggle(t)}
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                        isDone ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 hover:border-indigo-400 dark:border-white/20"
                      }`}>
                      {isDone && <Check className="h-3 w-3" strokeWidth={3} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-extrabold ${isDone ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"}`}>{t.title}</p>
                      {t.detail && <p className="text-xs text-slate-500 dark:text-slate-400">{t.detail}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${k.cls}`}>
                          <k.icon className="h-3 w-3" /> {k.label}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">~{t.estimated_minutes} min{t.concept ? ` · ${t.concept}` : ""}</span>
                        {t.kind === "assess" && (
                          <button onClick={() => onBigAssessment?.(t)}
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold text-white hover:bg-emerald-600">
                            Start <ChevronRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== notes */
function NotesTab({ ctx, grad }) {
  const [notes, setNotes] = useState([]);
  const [usage, setUsage] = useState({ used_bytes: 0, cap_bytes: 52428800 });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const fileRef = useRef(null);
  const params = ctx.topic_id ? { topic_id: ctx.topic_id } : { topic_name: ctx.topic_name };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await notesApi.list(params);
      setNotes(data.notes || []); setUsage(data.usage || usage);
    } catch { /* */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.topic_id, ctx.topic_name]);
  useEffect(() => { load(); }, [load]);

  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > usage.cap_bytes - usage.used_bytes) {
      setError(`Not enough space — ${fmtBytes(usage.cap_bytes - usage.used_bytes)} left in this topic.`); return;
    }
    setUploading(true);
    try {
      const note = await notesApi.upload(file, ctx);
      if (note?.status === "failed") setError(note?.meta?.error || "That file couldn't be read.");
      await load();
    } catch (err) { setError(err?.response?.data?.message || "Upload failed."); await load(); }
    finally { setUploading(false); }
  };

  const remove = async (id) => { try { await notesApi.remove(id); load(); } catch { /* */ } };

  const pct = Math.min(100, Math.round((usage.used_bytes / usage.cap_bytes) * 100));

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-800/60">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">Your notes</p>
          <p className="text-[11px] font-bold text-slate-400">{fmtBytes(usage.used_bytes)} / {fmtBytes(usage.cap_bytes)}</p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
          <div className={`h-full rounded-full ${pct > 90 ? "bg-rose-400" : "bg-gradient-to-r from-indigo-400 to-violet-500"}`} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff" className="hidden" onChange={onFile} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${grad} px-4 py-2.5 text-sm font-extrabold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-60`}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Reading your file…" : "Upload PDF, Word, Excel, image or text"}
        </button>
        {error && <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
      </div>

      {loading ? <Loading label="Loading notes…" /> : notes.length === 0 ? (
        <Empty icon={FileText} text="No notes yet. Upload your class notes, worksheets or a textbook page — the tutor will read them." />
      ) : notes.map((n) => (
        <div key={n.id} className="rounded-2xl border border-slate-100 bg-white p-3 dark:border-white/10 dark:bg-slate-800">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/10"><NoteIcon kind={n.kind} /></span>
            <button onClick={() => setOpenId(openId === n.id ? null : n.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{n.title}</span>
              <span className="block text-[11px] font-bold text-slate-400">
                {n.status === "processing" ? "Processing…" : n.status === "failed" ? (n.meta?.error || "Couldn't read this file") : fmtBytes(n.size_bytes)}
              </span>
            </button>
            {n.status === "processing" && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
            <button onClick={() => remove(n.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
          </div>
          {openId === n.id && n.summary && (
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-300">{n.summary}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================== flashcards */
function FlashcardsTab({ ctx, grad }) {
  const [cards, setCards] = useState([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dueCount, setDueCount] = useState(0);
  const params = ctx.topic_id ? { topic_id: ctx.topic_id } : { topic_name: ctx.topic_name };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const due = await flashcardsApi.due(params);
      setCards(due); setI(0); setFlipped(false); setDueCount(due.length);
    } catch { /* */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.topic_id, ctx.topic_name]);
  useEffect(() => { load(); }, [load]);

  const grade = async (g) => {
    const card = cards[i];
    if (!card) return;
    try { await flashcardsApi.review(card.id, g); } catch { /* */ }
    setFlipped(false);
    if (i + 1 < cards.length) setI(i + 1); else load();
  };

  if (loading) return <Loading label="Shuffling your deck…" />;
  if (cards.length === 0) return <Empty icon={Layers} text="No cards due right now. Upload notes or take an assessment to build your deck — cards resurface right before you'd forget them." />;

  const card = cards[i];
  return (
    <div className="space-y-4">
      <p className="text-center text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Card {i + 1} of {cards.length} due</p>
      <button onClick={() => setFlipped((f) => !f)}
        className="flex min-h-[14rem] w-full flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm transition-all hover:shadow-md dark:border-white/10 dark:bg-slate-800">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{flipped ? "Answer" : "Question"}</span>
        <span className="whitespace-pre-wrap text-base font-extrabold text-slate-800 dark:text-slate-100">{flipped ? card.back : card.front}</span>
        {!flipped && <span className="mt-2 text-[11px] font-bold text-indigo-400">Tap to reveal</span>}
      </button>

      {flipped ? (
        <div className="grid grid-cols-4 gap-2">
          {[["Again", 1, "bg-rose-500"], ["Hard", 3, "bg-amber-500"], ["Good", 4, "bg-indigo-500"], ["Easy", 5, "bg-emerald-500"]].map(([label, g, cls]) => (
            <button key={g} onClick={() => grade(g)}
              className={`rounded-2xl ${cls} px-2 py-3 text-xs font-extrabold text-white shadow-sm transition-transform active:scale-95`}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <button onClick={() => setFlipped(true)}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${grad} px-4 py-2.5 text-sm font-extrabold text-white shadow-md`}>
          Show answer
        </button>
      )}
    </div>
  );
}

/* =========================================================== what to fix */
// One student-facing place for "where I'm weak": the tutor's live read
// (mastery + memory) on top, then a single merged list of open misconceptions
// (from chat) + unresolved mistakes (from assessments), de-duped by text.
function FixTab({ ctx, mind, onReExplain }) {
  const [mistakes, setMistakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const params = ctx.topic_id ? { topic_id: ctx.topic_id } : { topic_name: ctx.topic_name };

  const load = useCallback(async () => {
    setLoading(true);
    try { setMistakes(await mistakesApi.index({ ...params, include_resolved: true })); }
    catch { /* */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.topic_id, ctx.topic_name]);
  useEffect(() => { load(); }, [load]);

  const resolveMistake = async (m) => {
    const updated = await mistakesApi.resolve(m.id);
    setMistakes((xs) => xs.map((x) => x.id === m.id ? updated : x));
  };

  // Open misconceptions the assessment mistakes already cover are dropped.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const mistakeText = new Set(mistakes.map((m) => norm(m.question) + " " + norm(m.concept)));
  const openMisc = (mind?.misconceptions || [])
    .filter((m) => m.status === "open")
    .filter((m) => ![...mistakeText].some((t) => t && t.includes(norm(m.description).slice(0, 24))));

  const openMistakes = mistakes.filter((m) => !m.resolved);
  const nothingToFix = !loading && openMisc.length === 0 && openMistakes.length === 0;

  return (
    <div className="space-y-5">
      {/* The tutor's live read on you (mastery + memory + next step) */}
      <TutorMind mind={mind} />

      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-slate-400">
          <Target className="h-3.5 w-3.5" /> Things to fix
        </p>

        {loading ? <Loading label="Checking your weak spots…" /> : nothingToFix ? (
          <Empty icon={Check} text="Nothing to fix right now — nice! Keep learning and take a check; anything you slip on shows up here." />
        ) : (
          <div className="space-y-3">
            {/* Misconceptions caught live in chat */}
            {openMisc.map((m) => (
              <div key={`misc-${m.id}`} className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3.5 dark:border-amber-500/20 dark:bg-amber-500/5">
                <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-amber-500">From your chat</p>
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{m.description}</p>
                <button onClick={() => onReExplain?.(`Earlier I had this misunderstanding: "${m.description}". Re-teach me this a different way, with a fresh example, so I really get it.`)}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-2.5 py-1.5 text-[11px] font-extrabold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
                  <PenLine className="h-3.5 w-3.5" /> Re-explain
                </button>
              </div>
            ))}

            {/* Mistakes auto-collected from assessments */}
            {mistakes.map((m) => (
              <div key={`mis-${m.id}`} className={`rounded-2xl border p-3.5 ${m.resolved ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/5" : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-800"}`}>
                {m.concept && <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{m.concept}</p>}
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{m.question}</p>
                <div className="mt-2 space-y-1 text-xs">
                  {m.student_answer && <p className="text-rose-500"><b>You:</b> {m.student_answer}</p>}
                  {m.correct_answer && <p className="text-emerald-600 dark:text-emerald-400"><b>Correct:</b> {m.correct_answer}</p>}
                  {m.explanation && <p className="text-slate-500 dark:text-slate-400">{m.explanation}</p>}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <button onClick={() => onReExplain?.(`I got this wrong: "${m.question}". Re-teach me this concept (${m.concept || "this"}) a different way so I really understand it.`)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-2.5 py-1.5 text-[11px] font-extrabold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
                    <PenLine className="h-3.5 w-3.5" /> Re-explain
                  </button>
                  <button onClick={() => resolveMistake(m)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-extrabold transition-colors ${
                      m.resolved ? "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300"
                    }`}>
                    {m.resolved ? <><RotateCcw className="h-3.5 w-3.5" /> Reopen</> : <><Check className="h-3.5 w-3.5" /> Got it</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared */
const Loading = ({ label }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-sm font-bold text-slate-400">
    <Loader2 className="h-5 w-5 animate-spin text-indigo-400" /> {label}
  </div>
);
const Empty = ({ icon: Icon, text }) => (
  <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/10"><Icon className="h-6 w-6" /></span>
    <p className="max-w-sm text-sm font-bold text-slate-400">{text}</p>
  </div>
);
