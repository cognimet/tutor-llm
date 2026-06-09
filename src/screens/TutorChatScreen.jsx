import React, { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send, Lightbulb, BookOpen, RotateCcw, Sparkles } from "lucide-react";
import { Backdrop, TopNav } from "../ui/components.jsx";
import { tint } from "../ui/tints.js";

// Starter prompts shown as chips — scoped to the topic.
const STARTERS = (topic) => [
  `Explain "${topic}" simply`,
  `Give me a solved example`,
  `What mistakes do students make here?`,
  `Quick 3-question check`,
];

// --- MVP stub. Replace with your Laravel API call. ---------------------------
// POST /api/tutor/chat  { board, klass, subject, topic, messages: [...] }
async function fetchTutorReply({ topic, text }) {
  await new Promise((r) => setTimeout(r, 700));
  return (
    `Great question about **${topic}**! Let's break it down step by step.\n\n` +
    `1. First, picture the core idea in plain terms.\n` +
    `2. Then we apply it to "${text.slice(0, 40)}…".\n` +
    `3. Finally, watch out for the classic mistake students make.\n\n` +
    `Want me to give you a solved example next?`
  );
}
// -----------------------------------------------------------------------------

function Bubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-2xl text-lg shadow-sm ${isUser ? "bg-slate-200" : "bg-gradient-to-br from-indigo-500 to-violet-500 text-white"}`}>
        {isUser ? "🧑‍🎓" : "🦉"}
      </div>
      <div className={`max-w-[78%] whitespace-pre-wrap rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-sm ${isUser ? "rounded-tr-md bg-indigo-500 text-white" : "rounded-tl-md border border-slate-100 bg-white text-slate-700"}`}>
        {content}
      </div>
    </div>
  );
}

export default function TutorChatScreen({ session, profile, onHome, onBack }) {
  const { subject, chapter, topic } = session;
  const t = tint(subject.tint);
  const [messages, setMessages] = useState([
    {
      role: "tutor",
      content: `Hi! I'm your tutor for **${topic}**. Ask me anything about this topic — I'll explain it step by step. Where should we start? 🦉`,
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  const send = async (text) => {
    const value = (text ?? input).trim();
    if (!value || typing) return;
    setMessages((m) => [...m, { role: "user", content: value }]);
    setInput("");
    setTyping(true);
    const reply = await fetchTutorReply({ topic, text: value });
    setTyping(false);
    setMessages((m) => [...m, { role: "tutor", content: reply }]);
  };

  return (
    <div className="flex h-screen flex-col">
      <Backdrop />
      <TopNav
        onHome={onHome}
        right={
          <button onClick={() => setMessages(messages.slice(0, 1))} className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200 hover:text-indigo-600">
            <RotateCcw className="h-3.5 w-3.5" /> New chat
          </button>
        }
      />

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-5 overflow-hidden px-4 py-5">
        {/* Topic context rail */}
        <aside className="hidden w-64 shrink-0 flex-col gap-4 lg:flex">
          <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600">
            <ArrowLeft className="h-4 w-4" /> Topics
          </button>
          <div className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-lg shadow-slate-200/40 backdrop-blur-sm">
            <div className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${t.soft}`}>{subject.emoji}</div>
            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">{subject.name} · {chapter}</p>
            <h2 className="mt-1 text-lg font-extrabold leading-snug text-slate-900">{topic}</h2>
            <div className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${t.soft} ${t.text}`}>
              <Sparkles className="h-3.5 w-3.5" /> Focused on this topic
            </div>
          </div>
          <div className="rounded-3xl border border-white/60 bg-white/60 p-5 text-sm text-slate-500 backdrop-blur-sm">
            <p className="flex items-center gap-2 font-bold text-slate-700"><Lightbulb className="h-4 w-4 text-amber-500" /> Tip</p>
            <p className="mt-2">Ask “why”, not just “what”. The tutor explains reasoning, not just answers.</p>
          </div>
        </aside>

        {/* Chat column */}
        <main className="flex min-w-0 flex-1 flex-col rounded-3xl border border-white/60 bg-white/50 shadow-xl shadow-slate-200/50 backdrop-blur-sm">
          {/* mobile topic header */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3 lg:hidden">
            <button onClick={onBack}><ArrowLeft className="h-5 w-5 text-slate-500" /></button>
            <div className={`grid h-8 w-8 place-items-center rounded-xl text-base ${t.soft}`}>{subject.emoji}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-slate-900">{topic}</p>
              <p className="truncate text-xs text-slate-400">{subject.name} · {chapter}</p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role === "user" ? "user" : "tutor"} content={m.content} />
            ))}
            {typing && (
              <div className="flex gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-lg text-white">🦉</div>
                <div className="flex items-center gap-1 rounded-3xl rounded-tl-md border border-slate-100 bg-white px-4 py-4">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-indigo-300" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Starter chips */}
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-2 px-5 pb-3">
              {STARTERS(topic).map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Composer */}
          <div className="border-t border-slate-100 p-3">
            <div className="flex items-end gap-2 rounded-3xl bg-white p-2 shadow-sm ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-indigo-300">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={`Ask anything about ${topic}…`}
                className="max-h-32 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || typing}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30 transition-all active:scale-95 disabled:opacity-40"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 px-2 text-center text-[11px] text-slate-400">
              <BookOpen className="mr-1 inline h-3 w-3" />
              Answers stay scoped to <b>{topic}</b> · {profile?.board?.toUpperCase()} Class {profile?.klass}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
