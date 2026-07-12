/**
 * Cmd/Ctrl-K topic search for chat-mode students (Class 9+): type a topic name,
 * jump straight into its tutor chat — no subject → chapter → topic digging.
 * Juniors keep navigation-only by design (search assumes fluent reading).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";

export default function TopicSearch({ subjects, onOpenTopic }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  // Flatten the curriculum once: every topic with its subject + chapter.
  const topics = useMemo(
    () => (subjects || []).flatMap((s) =>
      (s.chapters || []).flatMap((c) =>
        (c.topics || []).map((t) => ({
          id: t.id, name: t.name, chapter: c.name,
          subject_id: s.id, subject: s.name, tint: s.tint, emoji: s.emoji,
        })),
      ),
    ),
    [subjects],
  );

  const hits = useMemo(() => {
    const x = q.trim().toLowerCase();
    if (!x) return [];
    return topics.filter((t) => t.name.toLowerCase().includes(x) || t.chapter.toLowerCase().includes(x)).slice(0, 8);
  }, [q, topics]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ(""); setCursor(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const go = (t) => {
    setOpen(false);
    onOpenTopic({
      subject_id: t.subject_id, subject_name: t.subject, name: t.subject,
      tint: t.tint, emoji: t.emoji,
      from_notes: false, selected_note_ids: [],
      quest_style: "teach", tutor_vibe: "coach",
      topic_id: t.id, topic_name: t.name, chapter_name: t.chapter,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Search topics" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input ref={inputRef} value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
              if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === "Enter" && hits[cursor]) go(hits[cursor]);
            }}
            placeholder="Search any topic — e.g. Photosynthesis"
            aria-label="Search topics"
            className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100" />
          <kbd className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 dark:bg-slate-800">esc</kbd>
        </div>

        {q.trim() && (
          <ul className="max-h-80 overflow-y-auto p-2">
            {hits.length === 0 && (
              <li className="px-3 py-6 text-center text-sm font-semibold text-slate-400">
                No topic matches "{q.trim()}"
              </li>
            )}
            {hits.map((t, i) => (
              <li key={`${t.subject_id}-${t.id}`}>
                <button onClick={() => go(t)} onMouseEnter={() => setCursor(i)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${
                    i === cursor ? "bg-indigo-50 dark:bg-indigo-500/10" : ""
                  }`}>
                  <span className="text-lg">{t.emoji || "📘"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-slate-700 dark:text-slate-200">{t.name}</span>
                    <span className="block truncate text-[11px] font-bold text-slate-400">{t.subject} · {t.chapter}</span>
                  </span>
                  {i === cursor && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-indigo-400" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
