import React, { useEffect, useState, useCallback } from "react";
import {
  CalendarDays, Check, Loader2, Sparkles, BookOpen, Target, Repeat, ClipboardCheck,
  PartyPopper, RefreshCw, Gamepad2, ClipboardList,
} from "lucide-react";
import { plannerApi, notesApi, gamificationApi } from "../api/endpoints.js";
import NotesPlayHub from "./NotesPlayHub.jsx";
import { CelebrationOverlay } from "./Gamification.jsx";

/**
 * The study-notes plan as a checklist, pinned beside the chat. Same look as the
 * Study-hub planner (tasks grouped by date, circle checkboxes), plus an overall
 * completion bar. The plan is notes-driven and ISOLATED to the active session:
 * it's scoped to the chat's topic and built strictly from the open notes
 * (`noteIds`), so a different/old note's plan never bleeds in. Falls back to a
 * whole-subject plan when no topic/notes are in scope.
 */
const MS_DAY = 86400000;
const startToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
function dayLabel(s) {
  if (!s) return "Anytime";
  const d = new Date(s); d.setHours(0, 0, 0, 0);
  const n = Math.round((d - startToday()) / MS_DAY);
  if (n === 0) return "Today"; if (n === 1) return "Tomorrow"; if (n === -1) return "Yesterday";
  return new Date(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
const KIND = {
  learn:    { icon: BookOpen,       cls: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" },
  practice: { icon: Target,         cls: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" },
  revise:   { icon: Repeat,         cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" },
  assess:   { icon: ClipboardCheck, cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" },
};
// Gamified study-horizon presets (spec §4.3).
const HORIZONS = [
  ["day", "Class Test Sprint", "🏃"],
  ["week", "Weekly Adventure", "📅"],
  ["exam", "Exam Shield", "🛡️"],
];

export default function NotesChecklist({ topicName, chapterName, subjectName, noteIds = [], grad = "from-indigo-500 to-violet-500", onPrompt, refreshKey = 0 }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [horizon, setHorizon] = useState("week");
  const [examDate, setExamDate] = useState("");
  const [cheer, setCheer] = useState(false);
  const [remaking, setRemaking] = useState(false);   // re-build the plan from notes
  const [tab, setTab] = useState("board");           // board | play
  const [noteId, setNoteId] = useState(null);        // active note for the Play Hub
  const [celebration, setCelebration] = useState(null); // XP/badge reward overlay

  // The plan is scoped to the chat's topic; when launched from specific notes we
  // also isolate generation to exactly those notes. Stable string key for deps.
  const noteIdsKey = (noteIds || []).join(",");

  // Play Hub source: the active note when studying from notes, else the most
  // recent note in the subject.
  useEffect(() => {
    if (noteIds && noteIds.length) { setNoteId(noteIds[0]); return; }
    let alive = true;
    notesApi.list({ scope: "subject", subject_name: subjectName })
      .then((d) => { if (alive) setNoteId((d.notes || [])[0]?.id ?? null); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectName, noteIdsKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Topic scope isolates this plan from other notes/topics in the subject;
      // fall back to a subject-wide plan only when there's no topic in scope.
      const params = topicName ? { topic_name: topicName } : { scope: "subject", subject_name: subjectName };
      const d = await plannerApi.index(params);
      setPlans(d.plans || []);
    } catch { /* */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicName, subjectName, noteIdsKey]);
  useEffect(() => { load(); }, [load]);

  // A cleared Progress Gate auto-ticked a task on the server → re-pull so the
  // checklist shows the tick (and the completion bar) without a manual refresh.
  useEffect(() => {
    if (refreshKey) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const make = async () => {
    setBusy(true);
    try {
      const payload = topicName
        ? { scope: "topic", topic_name: topicName, chapter_name: chapterName, subject_name: subjectName,
            from_notes: true, note_ids: noteIds, horizon, exam_date: horizon === "exam" ? examDate : undefined }
        : { scope: "subject", subject_name: subjectName, from_notes: true,
            horizon, exam_date: horizon === "exam" ? examDate : undefined };
      await plannerApi.generate(payload);
      await load();
      setRemaking(false);
    } catch { /* */ } finally { setBusy(false); }
  };

  const toggle = async (task) => {
    try {
      const u = await plannerApi.toggleTask(task.id);
      setPlans((ps) => ps.map((p) => ({ ...p, tasks: (p.tasks || []).map((t) => t.id === task.id ? u : t) })));
      if (u.status === "done") {
        setCheer(true); setTimeout(() => setCheer(false), 1500);
        // Award XP for completing a quest → drives the celebration overlay.
        try {
          const reward = await gamificationApi.reward({ action: "complete_quest", topic: topicName || subjectName });
          setCelebration(reward);
        } catch { /* gamification is non-blocking */ }
      }
    } catch { /* */ }
  };

  // "Let's Go!" — push a pre-formatted, notes-grounded prompt into the chat.
  const launchQuest = (task) => {
    onPrompt?.(`Let's work on "${task.title}". Teach it to me step by step using my own notes, `
      + `with a clear example and a quick visual if it helps.`);
  };

  const allTasks = plans.flatMap((p) => p.tasks || []);
  const done = allTasks.filter((t) => t.status === "done").length;
  const pct = allTasks.length ? Math.round((done / allTasks.length) * 100) : 0;

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-slate-400"><Loader2 className="h-4 w-4 animate-spin text-indigo-400" /> Loading…</div>;
  }

  // No plan yet (or remaking) → build one from the student's notes.
  const board = (allTasks.length === 0 || remaking) ? (
      <div className="flex flex-col gap-3 p-1">
        <div className="text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-2xl dark:bg-indigo-500/15">🗺️</span>
          <p className="mt-2 text-sm font-extrabold text-slate-900 dark:text-white">{remaking ? "Remake your plan from notes" : "Make a plan from your notes"}</p>
          <p className="mt-0.5 text-[11px] font-bold text-slate-400">When do you want to be ready?</p>
        </div>
        <div className="grid gap-1.5">
          {HORIZONS.map(([id, label, emoji]) => (
            <button key={id} onClick={() => setHorizon(id)}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-extrabold transition-all ${
                horizon === id ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-300"}`}>
              <span className="text-base">{emoji}</span> {label}
            </button>
          ))}
        </div>
        {horizon === "exam" && (
          <input type="date" value={examDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setExamDate(e.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200" />
        )}
        <button onClick={make} disabled={busy || (horizon === "exam" && !examDate)}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${grad} px-4 py-2.5 text-sm font-extrabold text-white shadow-md disabled:opacity-40`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {busy ? "Making…" : "Make my plan ✨"}
        </button>
        {remaking && (
          <button onClick={() => setRemaking(false)} className="text-center text-[11px] font-bold text-slate-400 hover:text-indigo-600">Cancel</button>
        )}
      </div>
  ) : (
    <div className="space-y-4">
      {/* Overall completion */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3 dark:border-white/10 dark:bg-slate-800/60">
        <div className="flex items-center justify-between">
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Completion</p>
          <span className="text-xs font-extrabold text-indigo-500">{done}/{allTasks.length}</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
          <div className={`h-full rounded-full bg-gradient-to-r ${grad} transition-all`} style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        {cheer && <p className="mt-2 text-xs font-extrabold text-emerald-500">🎉 Nice — keep going!</p>}
        {pct === 100 && <p className="mt-2 inline-flex items-center gap-1 text-xs font-extrabold text-emerald-500"><PartyPopper className="h-4 w-4" /> All done — you're a star!</p>}
        <button onClick={() => setRemaking(true)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-extrabold text-slate-400 transition-colors hover:text-indigo-600">
          <RefreshCw className="h-3 w-3" /> Remake from my notes
        </button>
      </div>

      {plans.map((plan) => {
        const groups = {};
        for (const t of plan.tasks || []) (groups[t.scheduled_for || "—"] ||= []).push(t);
        return (
          <div key={plan.id}>
            <p className="mb-1.5 truncate text-sm font-extrabold text-slate-900 dark:text-white">{plan.title}</p>
            <div className="space-y-3">
              {Object.keys(groups).sort().map((d) => (
                <div key={d}>
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                    <CalendarDays className="h-3 w-3" /> {d === "—" ? "Anytime" : dayLabel(d)}
                  </p>
                  <div className="space-y-1.5">
                    {groups[d].map((t) => {
                      const k = KIND[t.kind] || KIND.learn;
                      const isDone = t.status === "done";
                      return (
                        <div key={t.id}
                          className={`rounded-2xl border p-2.5 transition-all ${
                            isDone ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5"
                              : "border-slate-100 bg-white hover:border-indigo-200 dark:border-white/10 dark:bg-slate-800"}`}>
                          <button onClick={() => toggle(t)} className="flex w-full items-start gap-2.5 text-left">
                            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                              isDone ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-white/20"}`}>
                              {isDone && <Check className="h-3 w-3" strokeWidth={3} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block text-[13px] font-extrabold leading-snug ${isDone ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"}`}>{t.title}</span>
                              <span className="mt-1 inline-flex items-center gap-1">
                                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold ${k.cls}`}><k.icon className="h-2.5 w-2.5" /> {t.kind}</span>
                                <span className="text-[10px] font-bold text-slate-400">~{t.estimated_minutes}m</span>
                              </span>
                            </span>
                          </button>
                          {!isDone && onPrompt && (
                            <button onClick={() => launchQuest(t)}
                              className={`mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br ${grad} px-3 py-1.5 text-[11px] font-extrabold text-white shadow-sm active:scale-[0.98]`}>
                              Let's Go! 🚀
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="pb-1 text-center text-[11px] font-bold text-slate-400">Tap a task when you finish it 👆</p>
    </div>
  );

  // Quest Board / Play Hub tabs (spec §3 & §4.4).
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-white/5">
        {[["board", "Quest Board", ClipboardList], ["play", "Play Hub", Gamepad2]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition-colors ${
              tab === id ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-800 dark:text-indigo-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {tab === "play" ? <NotesPlayHub noteId={noteId} /> : board}
      </div>
      <CelebrationOverlay reward={celebration} onClose={() => setCelebration(null)} />
    </div>
  );
}
