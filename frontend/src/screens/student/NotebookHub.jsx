import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  ArrowLeft, ChevronRight, Upload, Loader2, Trash2, Star, AlertTriangle, FileText, NotebookPen, Rocket,
} from "lucide-react";
import { notesApi } from "../../api/endpoints.js";
import { NoteIcon, fmtBytes } from "../../ui/NotesPicker.jsx";
import { tint } from "../../ui/tints.js";

/**
 * "Study from my notes" — a separate, kid-friendly system (classes 6–10).
 * Just two simple steps per subject: (1) add your notes, (2) press "Let's
 * study" — which opens one screen with the tutor AND a tick-as-you-go plan
 * checklist. No separate planning tab, no grown-up tutor controls.
 */
export default function NotebookHub({ subjects = [], onBack, onStudy }) {
  const [activeId, setActiveId] = useState(subjects.length === 1 ? subjects[0].id : null);
  const subject = subjects.find((s) => s.id === activeId);
  const grad = subject ? tint(subject.tint).grad : "from-indigo-500 to-violet-500";

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <button onClick={subject ? () => setActiveId(null) : onBack}
        className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 hover:text-indigo-600 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" /> {subject ? "All subjects" : "Back home"}
      </button>

      <div className="mb-6 flex items-center gap-3">
        <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${grad} text-white shadow-sm`}>
          <NotebookPen className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Study from my notes</h1>
          <p className="text-sm text-slate-400">Add your notes → press play → learn & tick things off. Easy! 🎈</p>
        </div>
      </div>

      {!subject ? (
        <>
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Pick a subject</h2>
          {subjects.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-400 dark:border-white/10 dark:bg-slate-800/60">
              Set up your class first, then come back to add your notes. 🙂
            </p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {subjects.map((s) => (
                <button key={s.id} onClick={() => { setActiveId(s.id); setStudying(false); }}
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
        </>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${tint(subject.tint).soft}`}>{subject.emoji}</span>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{subject.name}</h2>
          </div>

          {/* Step 1 — add notes */}
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-500 text-xs font-extrabold text-white">1</span>
            <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Add your notes & PDFs</p>
          </div>
          <NotesPanel subject={subject} grad={grad} />

          {/* Step 2 — study */}
          <div className="mt-7 mb-3 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-500 text-xs font-extrabold text-white">2</span>
            <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Start learning</p>
          </div>
          <button onClick={() => onStudy?.(subject)}
            className={`flex w-full items-center justify-center gap-2 rounded-3xl bg-gradient-to-br ${grad} px-5 py-4 text-base font-extrabold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl`}>
            <Rocket className="h-5 w-5" /> Let's study! 🚀
          </button>
          <p className="mt-2 text-center text-xs font-bold text-slate-400">Opens your tutor with a tick-as-you-go plan checklist beside it.</p>
        </>
      )}
    </div>
  );
}

/* ================================================================== notes */
function NotesPanel({ subject, grad }) {
  const [notes, setNotes] = useState([]);
  const [usage, setUsage] = useState({ used_bytes: 0, cap_bytes: 52428800 });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [warn, setWarn] = useState(null);
  const [scope, setScope] = useState("subject");
  const [chapterName, setChapterName] = useState("");
  const [topicName, setTopicName] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const fileRef = useRef(null);
  const params = { scope: "subject", subject_name: subject.name };
  const chapter = subject.chapters.find((c) => c.name === chapterName);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await notesApi.list(params); setNotes(d.notes || []); setUsage(d.usage || usage); }
    catch { /* */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.id]);
  useEffect(() => { load(); }, [load]);

  const ctxFor = () => ({
    subject_name: subject.name,
    chapter_name: scope !== "subject" ? chapterName : undefined,
    topic_name: scope === "topic" ? topicName : undefined,
  });

  const doUpload = async (file, force = false) => {
    setUploading(true); setError(""); setWarn(null);
    try {
      const note = await notesApi.upload(file, ctxFor(), { scope, is_primary: isPrimary, force });
      if (note?.status === "failed") setError(note?.meta?.error || "Hmm, I couldn't read that file. Try another one?");
      await load();
    } catch (err) {
      const v = err?.response?.data?.validation;
      if (v?.off_scope) setWarn({ message: err.response.data.message, file });
      else setError(err?.response?.data?.message || "Upload didn't work. Try again?");
    } finally { setUploading(false); }
  };

  const onFile = (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (scope === "chapter" && !chapterName) return setError("Pick a chapter first 🙂");
    if (scope === "topic" && !topicName) return setError("Pick a topic first 🙂");
    if (file.size > usage.cap_bytes - usage.used_bytes) return setError(`Not enough room — ${fmtBytes(usage.cap_bytes - usage.used_bytes)} left.`);
    doUpload(file);
  };

  const remove = async (id) => { try { await notesApi.remove(id); load(); } catch { /* */ } };
  const pct = Math.min(100, Math.round((usage.used_bytes / usage.cap_bytes) * 100));

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-800/60">
        <div className="flex items-center justify-between">
          <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">My notes</p>
          <p className="text-[11px] font-bold text-slate-400">{fmtBytes(usage.used_bytes)} / {fmtBytes(usage.cap_bytes)}</p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
          <div className={`h-full rounded-full ${pct > 90 ? "bg-rose-400" : "bg-gradient-to-r from-indigo-400 to-violet-500"}`} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">These notes are for</span>
          {[["subject", "Whole subject"], ["chapter", "One chapter"], ["topic", "One topic"]].map(([id, label]) => (
            <button key={id} onClick={() => setScope(id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold transition-colors ${
                scope === id ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                  : "bg-slate-100 text-slate-500 hover:text-slate-700 dark:bg-white/10 dark:text-slate-400"}`}>
              {label}
            </button>
          ))}
          <button onClick={() => setIsPrimary((v) => !v)} title="Most important — use these first"
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold transition-colors ${
              isPrimary ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                : "bg-slate-100 text-slate-500 hover:text-slate-700 dark:bg-white/10 dark:text-slate-400"}`}>
            <Star className={`h-3 w-3 ${isPrimary ? "fill-amber-500 text-amber-500" : ""}`} /> Most important
          </button>
        </div>

        {scope !== "subject" && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <select value={chapterName} onChange={(e) => { setChapterName(e.target.value); setTopicName(""); }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200">
              <option value="">Choose chapter…</option>
              {subject.chapters.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            {scope === "topic" && (
              <select value={topicName} onChange={(e) => setTopicName(e.target.value)} disabled={!chapter}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200">
                <option value="">Choose topic…</option>
                {(chapter?.topics || []).map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            )}
          </div>
        )}

        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff" className="hidden" onChange={onFile} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${grad} px-4 py-2.5 text-sm font-extrabold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-60`}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Checking your file…" : "📸 Add a PDF, photo, Word or text file"}
        </button>

        {error && <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 dark:bg-rose-500/10"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
        {warn && (
          <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warn.message}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => doUpload(warn.file, true)} className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-extrabold text-white">Use it anyway</button>
              <button onClick={() => setWarn(null)} className="rounded-lg px-2.5 py-1 text-[11px] font-extrabold text-amber-700 dark:text-amber-300">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm font-bold text-slate-400"><Loader2 className="h-4 w-4 animate-spin text-indigo-400" /> Loading…</div>
      ) : notes.length === 0 ? (
        <p className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-6 text-center text-xs font-bold text-slate-400 dark:border-white/10">
          <FileText className="h-4 w-4" /> No notes yet — add your class notes or a textbook photo. 📚
        </p>
      ) : notes.map((n) => (
        <div key={n.id} className="flex items-center gap-2.5 rounded-2xl border border-slate-100 bg-white p-3 dark:border-white/10 dark:bg-slate-800">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/10"><NoteIcon kind={n.kind} /></span>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">
              {n.is_primary && <Star className="mr-1 inline h-3 w-3 fill-amber-500 text-amber-500" />}{n.title}
            </span>
            <span className="block text-[11px] font-bold text-slate-400">
              {n.scope === "subject" ? "Whole subject" : n.scope === "chapter" ? `Chapter · ${n.chapter_name || ""}` : `Topic · ${n.topic_name || ""}`}
              {" · "}{n.status === "processing" ? "Reading…" : n.status === "failed" ? "Couldn't read" : fmtBytes(n.size_bytes)}
            </span>
          </div>
          {n.status === "processing" && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
          <button onClick={() => remove(n.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
