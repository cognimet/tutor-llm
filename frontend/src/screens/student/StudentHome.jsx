import React, { useState, useMemo } from "react";
import { Search, ChevronRight, ArrowLeft, MessageCircle, Target, Flame, Brain, ListChecks, GraduationCap, Pencil, X, Check, ArrowRight, Clock, Play, ClipboardCheck } from "lucide-react";
import { Card, Button } from "../../ui/components.jsx";
import { tint } from "../../ui/tints.js";
import CurriculumPicker from "../../ui/CurriculumPicker.jsx";

export default function StudentHome({ user, path, subjects, progress, plans = [], onOpenTopic, onOpenPlans, onTogglePlanItem, onStartTask, onSetLevel }) {
  const [active, setActive] = useState(null);
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const subject = subjects.find((s) => s.id === active);

  const filtered = useMemo(() => {
    if (!subject) return [];
    if (!q.trim()) return subject.chapters;
    const x = q.toLowerCase();
    return subject.chapters
      .map((c) => ({ ...c, topics: c.topics.filter((t) => t.name.toLowerCase().includes(x)) }))
      .filter((c) => c.topics.length || c.name.toLowerCase().includes(x));
  }, [subject, q]);

  const p = progress?.progress;

  // Flatten open next-step tasks across all active plans for the home preview.
  const openItems = useMemo(
    () =>
      (plans || [])
        .flatMap((pl) => (pl.items || []).map((it) => ({ ...it, topic_name: pl.topic_name })))
        .filter((it) => it.status !== "done"),
    [plans],
  );

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      {/* Greeting + progress snapshot */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Hi {user.name.split(" ")[0]} 👋</h1>
        <div className="flex flex-wrap items-center gap-2">
          {path ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-extrabold text-indigo-600 ring-1 ring-indigo-100">
              <GraduationCap className="h-3.5 w-3.5" /> {path}
            </span>
          ) : (
            <span className="text-slate-500">Ready to learn something today?</span>
          )}
          <button onClick={() => setPicking(true)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold text-slate-400 hover:bg-white hover:text-indigo-600">
            <Pencil className="h-3 w-3" /> Change
          </button>
        </div>
      </div>

      {p && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat icon={Brain} tintName="indigo" label="Mastery" value={`${p.mastery}%`} />
          <Stat icon={Target} tintName="emerald" label="Accuracy" value={`${p.accuracy}%`} />
          <Stat icon={ListChecks} tintName="amber" label="Open gaps" value={p.open_gaps} />
          <Stat icon={Flame} tintName="rose" label="Day streak" value={p.streak_days} />
        </div>
      )}

      {progress?.gaps?.length > 0 && (
        <Card className="mt-6 p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Focus areas the AI found</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {progress.gaps.slice(0, 6).map((g) => (
              <span key={g.id} className={`rounded-full px-3 py-1 text-xs font-bold ${sev(g.severity)}`}>
                {g.concept} · {g.topic_name}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Light next-steps preview — the persistent home for plan tasks. */}
      {openItems.length > 0 && (
        <Card className="mt-6 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500">
              <ListChecks className="h-4 w-4 text-indigo-500" /> Your next steps
            </p>
            <button onClick={onOpenPlans} className="inline-flex items-center gap-1 text-xs font-extrabold text-indigo-600 hover:text-indigo-700">
              View all{openItems.length > 3 ? ` (${openItems.length})` : ""} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {openItems.slice(0, 3).map((item) => {
              const isQuiz = /\b(quiz|re-?take|assessment|test|mock)\b/i.test(item.title || "");
              return (
                <div key={item.id}
                  className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 transition-all hover:border-indigo-200">
                  <button onClick={() => onTogglePlanItem?.(item)} title="Mark as done"
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-slate-300 transition-colors hover:border-indigo-400">
                    {item.status === "done" && <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />}
                  </button>
                  <button onClick={() => onStartTask?.(item, item.topic_name)} className="flex-1 text-left">
                    <p className="text-sm font-extrabold text-slate-800">{item.title}</p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-400">
                      <Clock className="h-3 w-3" /> ~{item.estimated_minutes} min{item.topic_name ? ` · ${item.topic_name}` : ""}
                    </p>
                  </button>
                  <button onClick={() => onStartTask?.(item, item.topic_name)}
                    className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-extrabold text-indigo-600 transition-colors hover:bg-indigo-500 hover:text-white">
                    {isQuiz ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {isQuiz ? "Quiz" : "Start"}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Curriculum browser */}
      <div className="mt-10">
        {subjects.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-3xl">🎓</div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">Set up your curriculum</h2>
            <p className="mx-auto mt-1 max-w-md text-slate-500">
              Choose your stage, board/exam/programme and class so your tutor and topics match your exact syllabus.
            </p>
            <div className="mx-auto mt-6 max-w-2xl text-left">
              <InlinePicker onSetLevel={onSetLevel} />
            </div>
          </Card>
        ) : !subject ? (
          <>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">What do you want to learn?</h2>
            <p className="mt-1 text-slate-500">Pick a subject, then a topic to start a focused chat.</p>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((s) => {
                const t = tint(s.tint);
                const n = s.chapters.reduce((a, c) => a + c.topics.length, 0);
                return (
                  <button key={s.id} onClick={() => { setActive(s.id); setQ(""); }}
                    className="group relative overflow-hidden rounded-3xl border border-white/60 bg-white/75 p-6 text-left shadow-lg shadow-slate-200/40 backdrop-blur-sm transition-all hover:-translate-y-1 hover:shadow-xl">
                    <div className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${t.grad} opacity-10 blur-2xl`} />
                    <div className={`grid h-14 w-14 place-items-center rounded-2xl text-3xl ${t.soft}`}>{s.emoji}</div>
                    <h3 className="mt-4 text-xl font-extrabold text-slate-900">{s.name}</h3>
                    <p className="mt-1 text-sm text-slate-400">{s.blurb}</p>
                    <div className="mt-5 flex items-center justify-between">
                      <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${t.soft} ${t.text}`}>{s.chapters.length} chapters · {n} topics</span>
                      <ChevronRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-indigo-400" />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setActive(null)} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 hover:text-indigo-600">
              <ArrowLeft className="h-4 w-4" /> All subjects
            </button>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-4">
                <div className={`grid h-16 w-16 place-items-center rounded-3xl text-3xl ${tint(subject.tint).soft}`}>{subject.emoji}</div>
                <div><h2 className="text-3xl font-extrabold tracking-tight">{subject.name}</h2><p className="text-slate-400">{subject.blurb}</p></div>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics…"
                  className="w-full rounded-2xl border border-slate-200 bg-white/80 py-3 pl-11 pr-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200" />
              </div>
            </div>
            <div className="mt-8 space-y-7">
              {filtered.map((ch) => (
                <div key={ch.id}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${tint(subject.tint).dot}`} />
                    <h3 className="text-sm font-extrabold uppercase tracking-wide text-slate-500">{ch.name}</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {ch.topics.map((topic) => (
                      <button key={topic.id}
                        onClick={() => onOpenTopic({ topic_id: topic.id, topic_name: topic.name, chapter_name: ch.name, subject_name: subject.name, tint: subject.tint, emoji: subject.emoji })}
                        className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white/80 p-4 text-left shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                        <span className="text-sm font-extrabold text-slate-700 group-hover:text-indigo-600">{topic.name}</span>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-500 transition-colors group-hover:bg-indigo-500 group-hover:text-white">
                          <MessageCircle className="h-4 w-4" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {picking && (
        <ChangeCurriculumModal
          currentLevelId={user.level_id}
          onClose={() => setPicking(false)}
          onSetLevel={async (sel) => { await onSetLevel(sel); setPicking(false); setActive(null); }}
        />
      )}
    </div>
  );
}

// Inline picker (used in the empty state) — saves as soon as a level is chosen.
function InlinePicker({ onSetLevel }) {
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => { if (!sel) return; setBusy(true); try { await onSetLevel(sel); } finally { setBusy(false); } };
  return (
    <div>
      <CurriculumPicker onChange={setSel} />
      <Button onClick={save} disabled={!sel || busy} className="mt-4 w-full">
        {busy ? "Saving…" : sel ? `Start learning · ${sel.label}` : "Choose your class"}
      </Button>
    </div>
  );
}

function ChangeCurriculumModal({ currentLevelId, onClose, onSetLevel }) {
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => { if (!sel) return; setBusy(true); try { await onSetLevel(sel); } catch { setBusy(false); } };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-3xl border border-white/60 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-slate-900">Change your curriculum</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-sm text-slate-500">Switching updates the topics you see and tailors the AI tutor to your level.</p>
        <div className="mt-5"><CurriculumPicker value={currentLevelId} onChange={setSel} /></div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!sel || busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, tintName, label, value }) {
  const t = tint(tintName);
  return (
    <Card className="p-4">
      <div className={`grid h-10 w-10 place-items-center rounded-2xl ${t.soft} ${t.text}`}><Icon className="h-5 w-5" /></div>
      <p className="mt-3 text-2xl font-extrabold text-slate-900">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </Card>
  );
}

function sev(s) {
  return { high: "bg-rose-50 text-rose-600", medium: "bg-amber-50 text-amber-600", low: "bg-emerald-50 text-emerald-600" }[s] || "bg-slate-100 text-slate-600";
}
