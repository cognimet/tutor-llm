import React, { useState, useMemo } from "react";
import { Search, ChevronRight, ArrowLeft, MessageCircle, Sparkles } from "lucide-react";
import { Backdrop, TopNav, Button } from "../ui/components.jsx";
import { tint } from "../ui/tints.js";
import { SUBJECTS, BOARDS } from "../data/curriculum.js";

export default function BrowseScreen({ profile, onHome, onOpenTopic }) {
  const [activeSubject, setActiveSubject] = useState(null);
  const [query, setQuery] = useState("");

  const board = BOARDS.find((b) => b.id === profile?.board);
  const subject = SUBJECTS.find((s) => s.id === activeSubject);

  const filteredTopics = useMemo(() => {
    if (!subject) return [];
    if (!query.trim()) return subject.chapters;
    const q = query.toLowerCase();
    return subject.chapters
      .map((ch) => ({ ...ch, topics: ch.topics.filter((t) => t.toLowerCase().includes(q)) }))
      .filter((ch) => ch.topics.length || ch.name.toLowerCase().includes(q));
  }, [subject, query]);

  return (
    <div className="min-h-screen">
      <Backdrop />
      <TopNav
        onHome={onHome}
        right={
          <div className="flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
            <span>{board?.emoji}</span> {board?.name} · Class {profile?.klass}
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-5 py-10">
        {!subject ? (
          <>
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              What do you want to learn today?
            </h2>
            <p className="mt-2 text-slate-500">Pick a subject, then choose a topic to start a focused chat with your tutor.</p>

            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {SUBJECTS.map((s) => {
                const t = tint(s.tint);
                const topicCount = s.chapters.reduce((n, c) => n + c.topics.length, 0);
                return (
                  <button
                    key={s.id}
                    onClick={() => { setActiveSubject(s.id); setQuery(""); }}
                    className="group relative overflow-hidden rounded-3xl border border-white/60 bg-white/75 p-6 text-left shadow-lg shadow-slate-200/40 backdrop-blur-sm transition-all hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${t.grad} opacity-10 blur-2xl`} />
                    <div className={`grid h-14 w-14 place-items-center rounded-2xl text-3xl ${t.soft}`}>{s.emoji}</div>
                    <h3 className="mt-4 text-xl font-extrabold text-slate-900">{s.name}</h3>
                    <p className="mt-1 text-sm text-slate-400">{s.blurb}</p>
                    <div className="mt-5 flex items-center justify-between">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${t.soft} ${t.text}`}>
                        {s.chapters.length} chapters · {topicCount} topics
                      </span>
                      <ChevronRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-indigo-400" />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setActiveSubject(null)} className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600">
              <ArrowLeft className="h-4 w-4" /> All subjects
            </button>

            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-4">
                <div className={`grid h-16 w-16 place-items-center rounded-3xl text-3xl ${tint(subject.tint).soft}`}>{subject.emoji}</div>
                <div>
                  <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">{subject.name}</h2>
                  <p className="text-slate-400">{subject.blurb}</p>
                </div>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search topics…"
                  className="w-full rounded-2xl border border-slate-200 bg-white/80 py-3 pl-11 pr-4 text-sm font-medium text-slate-700 outline-none ring-indigo-200 backdrop-blur-sm placeholder:text-slate-400 focus:ring-2"
                />
              </div>
            </div>

            <div className="mt-8 space-y-7">
              {filteredTopics.map((ch) => (
                <div key={ch.id}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${tint(subject.tint).dot}`} />
                    <h3 className="text-sm font-extrabold uppercase tracking-wide text-slate-500">{ch.name}</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {ch.topics.map((topic) => (
                      <button
                        key={topic}
                        onClick={() => onOpenTopic({ subject, chapter: ch.name, topic })}
                        className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white/80 p-4 text-left shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                      >
                        <span className="text-sm font-bold text-slate-700 group-hover:text-indigo-600">{topic}</span>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-500 transition-colors group-hover:bg-indigo-500 group-hover:text-white">
                          <MessageCircle className="h-4 w-4" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {filteredTopics.length === 0 && (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-white/60 p-10 text-center text-slate-400">
                  <Sparkles className="mx-auto h-6 w-6" />
                  <p className="mt-2 font-semibold">No topics match “{query}”.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
