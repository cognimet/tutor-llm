import React, { useState, useMemo } from "react";
import { Search, ChevronRight, ArrowLeft, Target, Flame, Brain, ListChecks, GraduationCap, Pencil, X, NotebookPen, Trophy, Compass, Check, Rocket } from "lucide-react";
import { Card, Button } from "../../ui/components.jsx";
import { tint } from "../../ui/tints.js";
import CurriculumPicker from "../../ui/CurriculumPicker.jsx";

export default function StudentHome({ user, path, subjects, progress, onOpenTopic, onOpenNotebooks, onOpenRewards, onSetLevel }) {
  const [active, setActive] = useState(null);
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);

  // Topic checkbox multi-select for syllabus study (no configurator popup).
  const [selectedIds, setSelectedIds] = useState(new Set()); // selected topic ids (multi-select)

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
  const grad = subject ? tint(subject.tint).grad : "from-indigo-500 to-violet-500";

  // Checkbox multi-select helpers, mirroring the Notes-list design.
  const toggleSelect = (topicId) => {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(topicId)) copy.delete(topicId); else copy.add(topicId);
      return copy;
    });
  };

  const toggleChapter = (chapter) => {
    const topicIds = chapter.topics.map((t) => t.id);
    const allChecked = topicIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      topicIds.forEach((id) => { if (allChecked) copy.delete(id); else copy.add(id); });
      return copy;
    });
  };

  const allTopics = useMemo(() => {
    if (!subject) return [];
    return subject.chapters.flatMap((c) => c.topics);
  }, [subject]);

  const selectedCount = selectedIds.size;
  const allSelected = selectedCount === allTopics.length && allTopics.length > 0;

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allTopics.map((t) => t.id)));
  };

  // Launch the syllabus-direct (plan-free) chat straight away — no configurator
  // popup. Teaching style + companion use sensible defaults and stay adjustable
  // from the in-chat mode picker. Single topic → topic-scoped; multiple → custom
  // quest; none → whole-subject syllabus.
  const launchSyllabus = () => {
    const selectedTopics = allTopics.filter((t) => selectedIds.has(t.id));

    const payload = {
      subject_id: subject.id,
      subject_name: subject.name,
      name: subject.name,
      tint: subject.tint,
      emoji: subject.emoji,
      from_notes: false, // syllabus-direct session
      selected_note_ids: [],
      quest_style: "teach",
      tutor_vibe: "coach",
    };

    if (selectedTopics.length === 1) {
      const activeTopic = selectedTopics[0];
      const parentChapter = subject.chapters.find((c) => c.topics.some((t) => t.id === activeTopic.id));
      payload.topic_id = activeTopic.id;
      payload.topic_name = activeTopic.name;
      payload.chapter_name = parentChapter?.name || null;
    } else if (selectedTopics.length > 1) {
      payload.topic_name = `${selectedTopics.length} selected topics`;
      payload.chapter_name = "Custom Syllabus Quest";
    } else {
      payload.topic_name = subject.name;
      payload.chapter_name = "Whole Subject Syllabus";
    }

    onOpenTopic(payload);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-5 py-8 pb-32">
      {/* 1. Welcoming header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Hi {user.name.split(" ")[0]} 👋
          </h1>
          <div className="flex items-center gap-2">
            {path ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-extrabold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                <GraduationCap className="h-3.5 w-3.5" /> {path}
              </span>
            ) : (
              <span className="text-sm font-semibold text-slate-500">Ready to learn something today?</span>
            )}
            <button onClick={() => setPicking(true)} className="inline-flex items-center gap-1 text-xs font-bold text-slate-400 transition-colors hover:text-indigo-600">
              <Pencil className="h-3 w-3" /> Change
            </button>
          </div>
        </div>
        {onOpenRewards && (
          <button onClick={onOpenRewards}
            className="inline-flex items-center gap-2 self-start rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-extrabold text-amber-600 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <Trophy className="h-4 w-4" /> My Rewards
          </button>
        )}
      </div>

      {/* 2. Premium progress snapshot */}
      {p && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat icon={Brain} tintName="indigo" label="Mastery" value={`${p.mastery}%`} />
          <Stat icon={Target} tintName="emerald" label="Accuracy" value={`${p.accuracy}%`} />
          <Stat icon={ListChecks} tintName="amber" label="Open gaps" value={p.open_gaps} />
          <Stat icon={Flame} tintName="rose" label="Day streak" value={`${p.streak_days} days`} />
        </div>
      )}

      {/* 3. Side-by-side dual pathway gateway */}
      {subjects.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          {/* Track A: Personal Notes Hub */}
          <button
            onClick={onOpenNotebooks}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-left text-white shadow-lg shadow-indigo-500/15 transition-transform hover:-translate-y-0.5 active:scale-95"
          >
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/10 blur-2xl transition-transform group-hover:scale-125" />
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20">
              <NotebookPen className="h-6 w-6" />
            </div>
            <h3 className="mt-5 text-xl font-extrabold">Personal Notes Hub 📝</h3>
            <p className="mt-1 text-sm leading-relaxed text-white/80">
              Upload textbook scans, homework photos, or classroom PDFs. Tuto reads your files, finds gaps, and plans your study sessions.
            </p>
          </button>

          {/* Track B: Syllabus Quest Board */}
          <button
            onClick={() => {
              // Show the subject library so the student picks a subject (no
              // auto-select, no animated scroll) — they pick, then study.
              setActive(null);
              setSelectedIds(new Set());
              document.getElementById("syllabus-universe")?.scrollIntoView();
            }}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-600 p-6 text-left text-white shadow-lg shadow-emerald-500/15 transition-transform hover:-translate-y-0.5 active:scale-95"
          >
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/10 blur-2xl transition-transform group-hover:scale-125" />
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20">
              <Compass className="h-6 w-6" />
            </div>
            <h3 className="mt-5 text-xl font-extrabold">Syllabus Quest Board 🏛️</h3>
            <p className="mt-1 text-sm leading-relaxed text-white/80">
              Study directly from official class textbooks and pre-loaded verified boards. Master curriculum chapters topic-by-topic.
            </p>
          </button>
        </div>
      )}

      {/* 4. Focus areas detected by AI */}
      {progress?.gaps?.length > 0 && (
        <Card className="border border-slate-100 bg-white/50 p-5 backdrop-blur-sm dark:border-white/5">
          <p className="text-xs font-extrabold uppercase tracking-widest text-slate-400">Focus areas detected by AI</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {progress.gaps.slice(0, 6).map((g) => (
              <span key={g.id} className={`rounded-full border px-3 py-1 text-xs font-extrabold shadow-sm ${sev(g.severity)}`}>
                {g.concept} · {g.topic_name}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* 5. Official syllabus & subject browser */}
      <div id="syllabus-universe" className="space-y-6 pt-4">
        {subjects.length === 0 ? (
          <Card className="border-2 border-dashed p-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-3xl">🎓</div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">Set up your curriculum</h2>
            <p className="mx-auto mt-1 max-w-md text-slate-500">Choose your stage, board/exam/programme and class to begin.</p>
            <div className="mx-auto mt-6 max-w-2xl text-left">
              <InlinePicker onSetLevel={onSetLevel} />
            </div>
          </Card>
        ) : !subject ? (
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Official Syllabus Library</h2>
            <p className="mt-1 text-sm text-slate-400">Pick a subject to explore its chapters and start learning.</p>

            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((s) => {
                const t = tint(s.tint);
                const n = s.chapters.reduce((a, c) => a + c.topics.length, 0);
                return (
                  <button key={s.id} onClick={() => { setActive(s.id); setSelectedIds(new Set()); setQ(""); }}
                    className="group relative overflow-hidden rounded-3xl border border-slate-100 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-md dark:border-white/5 dark:bg-slate-800">
                    <div className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${t.soft}`}>{s.emoji}</div>
                    <h3 className="mt-4 text-lg font-extrabold text-slate-900 dark:text-white">{s.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">{s.blurb}</p>
                    <div className="mt-5 flex items-center justify-between border-t border-slate-50 pt-4 dark:border-white/5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${t.soft} ${t.text}`}>
                        {s.chapters.length} ch · {n} topics
                      </span>
                      <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button onClick={() => { setActive(null); setSelectedIds(new Set()); }} className="flex items-center gap-1 text-sm font-extrabold text-slate-500 hover:text-indigo-600">
                <ArrowLeft className="h-4 w-4" /> Back to subjects
              </button>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics…"
                  className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-11 pr-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-800" />
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3 border-b pb-4 dark:border-white/5 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <div className={`grid h-14 w-14 place-items-center rounded-2xl text-2xl ${tint(subject.tint).soft}`}>{subject.emoji}</div>
                <div>
                  <h2 className="text-2xl font-extrabold">{subject.name} Syllabus</h2>
                  <p className="text-sm text-slate-400">{subject.blurb}</p>
                </div>
              </div>
              {allTopics.length > 1 && (
                <button onClick={toggleAll} className="text-xs font-extrabold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400">
                  {allSelected ? "Deselect all topics" : "Select all topics"}
                </button>
              )}
            </div>

            {/* Checkbox multi-select chapters & topics explorer */}
            <div className="grid gap-6">
              {filtered.map((ch) => {
                const chTopicIds = ch.topics.map((t) => t.id);
                const chAllChecked = chTopicIds.length > 0 && chTopicIds.every((id) => selectedIds.has(id));
                return (
                  <div key={ch.id} className="rounded-2xl border border-slate-100 bg-white/50 p-5 dark:border-white/5 dark:bg-slate-800/30">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-slate-400">
                        <span className={`h-2 w-2 rounded-full ${tint(subject.tint).dot}`} />
                        {ch.name}
                      </h3>
                      <button onClick={() => toggleChapter(ch)} className="text-[10px] font-extrabold text-slate-400 transition-colors hover:text-emerald-600">
                        {chAllChecked ? "Deselect chapter" : "Select chapter"}
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {ch.topics.map((topic) => {
                        const isSelected = selectedIds.has(topic.id);
                        return (
                          <div key={topic.id}
                            onClick={() => toggleSelect(topic.id)}
                            className={`group flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-4 text-left shadow-sm transition-all ${
                              isSelected
                                ? "border-emerald-500 bg-emerald-50/20 dark:border-emerald-400 dark:bg-emerald-500/10"
                                : "border-slate-100 bg-white hover:border-slate-200 dark:border-white/5 dark:bg-slate-800"
                            }`}>
                            <div className="flex min-w-0 items-center gap-2.5">
                              {/* Sleek multi-selection checkbox matching the Notes list */}
                              <div className={`grid h-5 w-5 shrink-0 place-items-center rounded-lg border transition-all duration-150 ${
                                isSelected
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : "border-slate-300 bg-slate-50 dark:border-white/10 dark:bg-slate-900"
                              }`}>
                                {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                              </div>
                              <span className={`truncate text-sm font-extrabold ${isSelected ? "text-emerald-700 dark:text-emerald-300" : "text-slate-700 group-hover:text-emerald-600 dark:text-slate-100"}`}>
                                {topic.name}
                              </span>
                            </div>
                            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-xl transition-all ${
                              isSelected ? "bg-emerald-500 text-white" : "bg-slate-50 text-slate-400 group-hover:bg-slate-100"
                            }`}>
                              <Compass className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 🚀 Dynamic bottom floating action bar — mirrors "Study from my notes" */}
      {subject && (
        <div className="msg-in fixed bottom-6 left-1/2 z-40 flex w-[92%] max-w-lg -translate-x-1/2 items-center justify-between rounded-full bg-slate-900/90 p-2.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md dark:bg-slate-950/95">
          <div className="pl-4">
            <p className="text-sm font-extrabold text-white">
              {selectedCount > 0 ? `${selectedCount} topic${selectedCount > 1 ? "s" : ""} selected` : "Whole Subject Syllabus"}
            </p>
            <p className="text-[10px] font-bold text-slate-400">
              {selectedCount > 0 ? "Launch a unified study quest" : "Study direct subject syllabus — no notes"}
            </p>
          </div>
          <button
            onClick={launchSyllabus}
            className={`flex items-center gap-2 rounded-full bg-gradient-to-r ${grad} px-5 py-3 text-sm font-extrabold text-white shadow-lg transition-transform hover:shadow-indigo-500/20 active:scale-95`}
          >
            {selectedCount > 0 ? (
              <><Rocket className="h-4 w-4" /> <span>Let's study! 🚀</span></>
            ) : (
              <><Compass className="h-4 w-4" /> <span>Study Whole Syllabus 🏛️</span></>
            )}
          </button>
        </div>
      )}


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
      <div className="relative w-full max-w-2xl rounded-3xl border border-white/60 bg-white dark:bg-slate-800 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">Change your curriculum</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-white/10"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Switching updates the topics you see and tailors the AI tutor to your level.</p>
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
      <p className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </Card>
  );
}

function sev(s) {
  return { high: "bg-rose-50 text-rose-600", medium: "bg-amber-50 text-amber-600", low: "bg-emerald-50 text-emerald-600" }[s] || "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300";
}
