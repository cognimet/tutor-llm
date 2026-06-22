import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ChevronRight, Loader2, Trash2, Star, AlertTriangle, FileText,
  NotebookPen, Rocket, Camera, Check, Sparkles, Wand2, X,
} from "lucide-react";
import { notesApi, gamificationApi } from "../../api/endpoints.js";
import { NoteIcon, fmtBytes } from "../../ui/NotesPicker.jsx";
import { tint } from "../../ui/tints.js";
import { XpBar, CelebrationOverlay } from "../../ui/Gamification.jsx";

/**
 * "Study from my notes" — gamified Quest flow for classes 6–10 (revamp spec).
 * Step 1 is now a zero-friction **Smart Drop**: snap or drop a note, the AI
 * reads it, auto-scopes it to the curriculum, audits it, and shows a friendly
 * Auto-Confirm card. Then press "Let's study" to enter the tutor + quest board.
 */
export default function NotebookHub({ subjects = [], onBack, onStudy }) {
  const [activeId, setActiveId] = useState(subjects.length === 1 ? subjects[0].id : null);
  const [stats, setStats] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const subject = subjects.find((s) => s.id === activeId);
  const grad = subject ? tint(subject.tint).grad : "from-indigo-500 to-violet-500";

  const refreshStats = useCallback(() => {
    gamificationApi.stats().then(setStats).catch(() => {});
  }, []);
  useEffect(() => { refreshStats(); }, [refreshStats]);

  // Called whenever a Smart Drop succeeds; drives XP/badge celebration.
  const onReward = (reward) => { if (reward) setCelebration(reward); refreshStats(); };

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <button onClick={subject ? () => setActiveId(null) : onBack}
          className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 hover:text-indigo-600 dark:text-slate-400">
          <ArrowLeft className="h-4 w-4" /> {subject ? "All subjects" : "Back home"}
        </button>
        <XpBar stats={stats} />
      </div>

      <div className="mb-6 flex items-center gap-3">
        <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${grad} text-white shadow-sm`}>
          <NotebookPen className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">🌟 Study from my notes</h1>
          <p className="text-sm text-slate-400">Snap or drop your notes — I'll read them, sort them, and build your quest. 🎈</p>
        </div>
      </div>

      {/* Step 1 — Smart Drop (always front and centre) */}
      <SmartDrop onReward={onReward} onStudy={onStudy} />

      {/* Browse existing notes per subject + launch study */}
      {!subject ? (
        <div className="mt-8">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Or jump into a subject</h2>
          {subjects.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-400 dark:border-white/10 dark:bg-slate-800/60">
              Set up your class first, then come back to add your notes. 🙂
            </p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {subjects.map((s) => (
                <button key={s.id} onClick={() => setActiveId(s.id)}
                  className="group flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-slate-800/70">
                  <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-3xl ${tint(s.tint).soft}`}>{s.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-extrabold text-slate-900 dark:text-white">{s.name}</span>
                    <span className="block text-xs font-bold text-slate-400">{s.chapters.reduce((a, c) => a + c.topics.length, 0)} topics</span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-indigo-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-8">
          <div className="mb-4 flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-2xl text-xl ${tint(subject.tint).soft}`}>{subject.emoji}</span>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">{subject.name} notes</h2>
          </div>
          {/* Pick exactly the notes to study — the floating bar launches a
              grounded, note-scoped session (or the whole subject if none). */}
          <NotesList subject={subject} onStudy={onStudy} />
        </div>
      )}

      <CelebrationOverlay reward={celebration} onClose={() => setCelebration(null)} />
    </div>
  );
}

/* ============================================================== Smart Drop */

function SmartDrop({ onReward, onStudy }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const camRef = useRef(null);

  const handle = async (file) => {
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await notesApi.autoScope(file);
      setResult(res);
      onReward?.(res.gamification);
    } catch (err) {
      setError(err?.response?.data?.message || "Hmm, that didn't work. Try a clearer photo or another file. 📸");
    } finally { setBusy(false); }
  };

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    handle(e.dataTransfer.files?.[0]);
  };

  if (result) return <AutoConfirmCard result={result} onStudy={onStudy} onReset={() => setResult(null)} />;

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed p-8 text-center transition-all ${
          drag ? "border-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10"
            : "border-slate-300 bg-white dark:border-white/15 dark:bg-slate-800/50"}`}>
        {busy ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="font-extrabold text-slate-700 dark:text-slate-200">Reading your notes… ✍️</p>
            <p className="text-xs text-slate-400">Spotting the topic, keywords and any fix-its</p>
          </>
        ) : (
          <>
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
              <Camera className="h-7 w-7" />
            </span>
            <p className="text-lg font-extrabold text-slate-900 dark:text-white">📸 Snap or drop your notes</p>
            <p className="max-w-sm text-sm text-slate-400">Drag a school PDF or snap a photo of your notebook — no need to pick the chapter, I'll figure it out!</p>
            <div className="mt-1 flex gap-2">
              <button onClick={() => fileRef.current?.click()}
                className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-md active:scale-95">
                Choose a file
              </button>
              <button onClick={() => camRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-extrabold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-white/10 dark:text-slate-300">
                <Camera className="h-4 w-4" /> Snap
              </button>
            </div>
          </>
        )}
        <input ref={fileRef} type="file" className="hidden"
          accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handle(f); }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handle(f); }} />
      </div>
      {error && (
        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

/** The "🔍 We read your notes!" Auto-Confirm card (spec Step 1). */
function AutoConfirmCard({ result, onStudy, onReset }) {
  const d = result.detected || {};
  const ins = result.insights || {};
  const corrections = ins.corrections || [];
  const scopeLine = [d.subject_name, d.chapter_name, d.topic_name].filter(Boolean).join(" → ") || "your notes";

  const removeAndReset = async () => {
    try { if (result.note_id) await notesApi.remove(result.note_id); } catch { /* ignore */ }
    onReset?.();
  };

  return (
    <div className="auth-rise rounded-3xl border border-indigo-200 bg-white p-5 shadow-lg dark:border-indigo-500/30 dark:bg-slate-800">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"><Wand2 className="h-5 w-5" /></span>
        <p className="font-display text-lg font-extrabold text-slate-900 dark:text-white">🔍 I read your notes!</p>
        {result.low_confidence && (
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">not sure — check this</span>
        )}
      </div>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        It looks like <b className="text-slate-900 dark:text-white">{scopeLine}</b>.
      </p>

      {!!(ins.keywords || []).length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ins.keywords.slice(0, 8).map((k) => (
            <span key={k} className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">{k}</span>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs font-semibold text-slate-400">
        {ins.formula_count ? `${ins.formula_count} formula${ins.formula_count > 1 ? "s" : ""}` : "No formulas"} ·
        {ins.diagrams_found ? " diagrams spotted ✏️" : " no diagrams"}
      </p>

      {/* Fix-it quests from the Smart Inspector */}
      {corrections.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">🛠️ Fix-it quest{corrections.length > 1 ? "s" : ""}</p>
          {corrections.map((c, i) => {
            // Tolerate both schema shapes: {wrong_text, corrected_text, explanation}
            // and the strict inspector's {mistake, correction}.
            const wrong = c.wrong_text || c.mistake;
            const right = c.corrected_text || c.correction;
            const note = c.explanation || c.note;
            return (
              <div key={i} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20">
                <p className="font-bold">{note || "Let's double-check this!"}</p>
                {(wrong || right) && (
                  <p className="mt-1">
                    {wrong && <span className="line-through opacity-70">{wrong}</span>}
                    {right && <span className="ml-2 font-extrabold">→ {right}</span>}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => onStudy?.({
            id: d.subject_id,
            name: d.subject_name,
            subject_name: d.subject_name,
            topic_name: d.topic_name || d.subject_name,
            chapter_name: d.chapter_name || null,
            emoji: "📘",
            tint: "indigo",
            chapters: [],
            // Ground the chat in the note we just read, scoped to its topic.
            selected_note_ids: result.note_id ? [result.note_id] : [],
          })}
          disabled={!d.subject_id}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-md active:scale-95 disabled:opacity-50">
          <Check className="h-4 w-4" /> Correct! Let's go 🚀
        </button>
        <button onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-extrabold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-white/10 dark:text-slate-300">
          <Sparkles className="h-4 w-4" /> Drop another
        </button>
        <button onClick={removeAndReset}
          className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2.5 text-sm font-bold text-slate-400 hover:text-rose-500">
          <X className="h-4 w-4" /> Not right
        </button>
      </div>
    </div>
  );
}

/* ============================================================ notes list */

function NotesList({ subject, onStudy }) {
  // Streamlined personal notes manager: homework uploads, PDF extraction,
  // auto-scoping, and note-scoped study sessions. (Official syllabus study now
  // lives on the home screen's Syllabus Quest board.)
  const [notes, setNotes] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const grad = tint(subject.tint).grad;

  const load = useCallback(() => {
    notesApi.list({ scope: "subject", subject_name: subject.name })
      .then((d) => {
        const list = d.notes || [];
        setNotes(list);
        // Pre-select every readable note so the student can launch instantly.
        setSelectedIds(new Set(list.filter((n) => n.status === "ready").map((n) => n.id)));
      })
      .catch(() => setNotes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.id]);
  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id); else copy.add(id);
      return copy;
    });
  };

  const remove = async (id) => {
    try {
      await notesApi.remove(id);
      setSelectedIds((prev) => { const copy = new Set(prev); copy.delete(id); return copy; });
      load();
    } catch { /* ignore */ }
  };

  if (notes === null) {
    return <div className="flex items-center justify-center gap-2 py-6 text-sm font-bold text-slate-400"><Loader2 className="h-4 w-4 animate-spin text-indigo-400" /> Loading…</div>;
  }
  if (notes.length === 0) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-6 text-center text-xs font-bold text-slate-400 dark:border-white/10">
        <FileText className="h-4 w-4" /> No notes here yet — Smart Drop one above. 📚
      </p>
    );
  }

  const readyNotes = notes.filter((n) => n.status === "ready");
  const selectedCount = selectedIds.size;
  const allSelected = selectedCount === readyNotes.length && readyNotes.length > 0;

  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(readyNotes.map((n) => n.id)));

  // Intelligent topic routing: if all selected notes share one topic (or one
  // chapter), scope the chat directly to it; otherwise launch a combined,
  // note-scoped session. Either way we carry the exact selected_note_ids.
  const handleLaunchStudy = () => {
    const activeNotes = notes.filter((n) => selectedIds.has(n.id));
    if (!activeNotes.length) return;
    const uniqueTopics = [...new Set(activeNotes.map((n) => n.topic_name).filter(Boolean))];
    const uniqueChapters = [...new Set(activeNotes.map((n) => n.chapter_name).filter(Boolean))];

    const payload = {
      subject_id: subject.id,
      subject_name: subject.name,
      name: subject.name,
      tint: subject.tint,
      emoji: subject.emoji,
      from_notes: true,
      selected_note_ids: Array.from(selectedIds),
    };

    if (uniqueTopics.length === 1) {
      payload.topic_name = uniqueTopics[0];
      payload.chapter_name = activeNotes[0].chapter_name || null;
    } else if (uniqueChapters.length === 1) {
      payload.topic_name = uniqueChapters[0];
      payload.chapter_name = uniqueChapters[0];
    } else {
      payload.topic_name = `${subject.name} (selected notes)`;
    }

    onStudy?.(payload);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-white/10">
        <p className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
          Library ({notes.length} note{notes.length > 1 ? "s" : ""})
        </p>
        {readyNotes.length > 1 && (
          <button onClick={toggleAll} className="text-xs font-extrabold text-indigo-500 hover:text-indigo-600">
            {allSelected ? "Deselect all" : "Select all ready"}
          </button>
        )}
      </div>

      <div className="grid gap-2.5 pb-24">
        {notes.map((n) => {
          const isReady = n.status === "ready";
          const isSelected = selectedIds.has(n.id);
          // Topic name leads; the file name rides in the subtitle. Falls back to
          // the file name when a note isn't scoped to a specific topic/chapter.
          const topicLabel = n.scope === "subject" ? (n.subject_name || "")
            : n.scope === "chapter" ? (n.chapter_name || "")
            : (n.topic_name || "");
          const headline = topicLabel || n.title;
          const subLead = topicLabel
            ? n.title
            : (n.scope === "subject" ? "Whole subject" : n.scope === "chapter" ? "Chapter" : "Topic");
          const statusText = n.status === "processing" ? "Reading…" : n.status === "failed" ? "Couldn't read" : fmtBytes(n.size_bytes);
          return (
            <div
              key={n.id}
              onClick={() => isReady && toggleSelect(n.id)}
              className={`group relative flex items-center gap-2.5 rounded-2xl border p-3 transition-all duration-200 ${
                isReady ? "cursor-pointer" : "cursor-default opacity-80"
              } ${
                isSelected
                  ? "border-indigo-500 bg-indigo-50/50 shadow-sm dark:border-indigo-400 dark:bg-indigo-500/10"
                  : "border-slate-100 bg-white hover:border-slate-200 dark:border-white/10 dark:bg-slate-800"
              }`}
            >
              {/* Selection checkbox */}
              <div
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-lg border transition-all duration-200 ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-500 text-white"
                    : "border-slate-300 bg-slate-50 dark:border-white/20 dark:bg-slate-900"
                } ${isReady ? "" : "opacity-40"}`}
              >
                {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </div>

              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/10"><NoteIcon kind={n.kind} /></span>

              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">
                  {n.is_primary && <Star className="mr-1 inline h-3 w-3 fill-amber-500 text-amber-500" />}{headline}
                </span>
                <span className="block truncate text-[11px] font-bold text-slate-400">
                  {subLead}{" · "}{statusText}
                </span>
              </div>

              {n.status === "processing" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-400" />}
              <button
                onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 opacity-0 transition-opacity duration-150 hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Sleek floating bar — launch a grounded study session from selected notes */}
      {selectedCount > 0 && (
        <div className="msg-in fixed bottom-6 left-1/2 z-40 flex w-[92%] max-w-lg -translate-x-1/2 items-center justify-between rounded-full bg-slate-900/90 p-2.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md dark:bg-slate-950/95">
          <div className="pl-4">
            <p className="text-sm font-extrabold text-white">{selectedCount} note{selectedCount > 1 ? "s" : ""} selected</p>
            <p className="text-[10px] font-bold text-slate-400">Launch a tailored grounded quest</p>
          </div>
          <button
            onClick={handleLaunchStudy}
            className={`flex items-center gap-2 rounded-full bg-gradient-to-r ${grad} px-5 py-3 text-sm font-extrabold text-white shadow-lg transition-transform hover:shadow-indigo-500/20 active:scale-95`}
          >
            <Rocket className="h-4 w-4" /> Let's study! 🚀
          </button>
        </div>
      )}
    </div>
  );
}
