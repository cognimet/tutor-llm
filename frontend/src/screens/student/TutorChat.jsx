import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Send, Square, ClipboardCheck, Sparkles,
  Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, Plus, MessageSquare,
  ChevronRight, ChevronDown, Search, X, Volume2, VolumeX, History, ShieldCheck,
  Pencil, MoreVertical, Download, Keyboard, ArrowDown,
  Mic, MicOff, Camera, Maximize2, PenLine, LogOut,
  Sparkles as SparklesIcon, CalendarClock, Paperclip, ListChecks,
  FileText, Loader2, HelpCircle, Calculator,
} from "lucide-react";
import { tint } from "../../ui/tints.js";
import CreditMeter from "../../ui/CreditMeter.jsx";
import { ThemeToggle } from "../../ui/components.jsx";
import { tutorApi, plannerApi, notesApi } from "../../api/endpoints.js";
import { streamSSE } from "../../api/stream.js";
import Markdown from "../../ui/Markdown.jsx";
import RichMessage from "../../ui/RichMessage.jsx";
import AssessmentFlow from "./AssessmentFlow.jsx";
import Whiteboard from "../../ui/Whiteboard.jsx";
import StudyHub from "../../ui/StudyHub.jsx";
import NotesPicker, { fmtBytes } from "../../ui/NotesPicker.jsx";
import NextStep from "../../ui/NextStep.jsx";
import ScreenTimeTracker from "../../ui/ScreenTimeTracker.jsx";
import NotesChecklist from "../../ui/NotesChecklist.jsx";
import FigureStrip from "../../ui/FigureStrip.jsx";
import { flashcardsApi, mistakesApi } from "../../api/endpoints.js";

const STARTERS = (t) => [
  { icon: "💡", label: `Explain "${t}" simply` },
  { icon: "📝", label: `Walk me through a solved example` },
  { icon: "⚠️", label: `What mistakes do students make here?` },
  { icon: "🎯", label: `Quiz me with one quick question` },
];

// Contextual follow-ups shown after the tutor finishes a reply.
const FOLLOWUPS = [
  { icon: "🪄", label: "Explain that more simply" },
  { icon: "➕", label: "Show me another example" },
  { icon: "📊", label: "Visualize this" },
  { icon: "❓", label: "Why is that true?" },
  { icon: "🎯", label: "Quiz me on this" },
  { icon: "📝", label: "Give me exam tips for this" },
  { icon: "🗒️", label: "Summarise this as revision notes" },
];

// Tutor modes — change how the tutor teaches (sent with each message).
const MODES = [
  { id: "teach",    label: "Teach",    icon: "📘", hint: "Step-by-step explanations" },
  { id: "socratic", label: "Socratic", icon: "🤔", hint: "Guides with questions only" },
  { id: "quiz",     label: "Quiz",     icon: "🎯", hint: "Drills you with questions" },
  { id: "exam",     label: "Exam",     icon: "📝", hint: "Board-exam coaching" },
  { id: "eli10",    label: "Simple",   icon: "🧒", hint: "Explain like I'm 10" },
];

/* ----------------------------------------------------------------- helpers */

function relTime(ts) {
  if (!ts) return "";
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Bucket sessions into Today / Yesterday / Previous 7 days / Earlier.
function groupSessions(list) {
  const buckets = { Today: [], Yesterday: [], "Previous 7 days": [], Earlier: [] };
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const s of list) {
    const raw = s.last_message_at || s.updated_at || s.created_at;
    const d = raw ? new Date(raw) : new Date();
    const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startToday - startDay) / 86400000);
    if (days <= 0) buckets.Today.push(s);
    else if (days === 1) buckets.Yesterday.push(s);
    else if (days <= 7) buckets["Previous 7 days"].push(s);
    else buckets.Earlier.push(s);
  }
  return Object.entries(buckets).filter(([, v]) => v.length);
}

// Best-effort plain text for read-aloud: drop math/code/markdown noise.
function speakable(md) {
  return String(md || "")
    .replace(/```(?:viz|chart|plot|graph)[^\n]*\n[\s\S]*?```/gi, " (see the visualization) ")
    .replace(/\$\$[\s\S]*?\$\$/g, " (see the equation) ")
    .replace(/\\\[[\s\S]*?\\\]/g, " (see the equation) ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/\$[^$\n]+\$/g, " ")
    .replace(/```[\s\S]*?```/g, " (see the code block) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Build a shareable Markdown transcript of the current conversation.
function buildTranscript(ctx, messages) {
  const sub = `${ctx.subject_name || ""}${ctx.chapter_name ? ` · ${ctx.chapter_name}` : ""}`;
  const head = `# ${ctx.topic_name || "Tutor chat"}\n${sub}\n\n`;
  const body = messages
    .filter((m) => m.content && !m.error)
    .map((m) => `**${m.role === "user" ? "You" : "Tutor"}**\n\n${m.content}`)
    .join("\n\n---\n\n");
  return `${head}${body}\n`;
}

// Per-session composer drafts so unsent text survives chat switches / reloads.
const draftKey = (id) => `tutorchat:draft:${id}`;
function loadDraft(id) {
  try { return id ? localStorage.getItem(draftKey(id)) || "" : ""; } catch { return ""; }
}
function saveDraft(id, text) {
  try {
    if (!id) return;
    if (text && text.trim()) localStorage.setItem(draftKey(id), text);
    else localStorage.removeItem(draftKey(id));
  } catch { /* storage unavailable */ }
}

// True when focus is in a text field (so global shortcuts don't hijack typing).
function isTyping(el) {
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
const MOD = isMac ? "⌘" : "Ctrl";

/* -------------------------------------------------------------- primitives */

function Avatar({ user, t }) {
  return (
    <div
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-2xl text-lg shadow-sm ${
        user ? "bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-white/10" : `bg-gradient-to-br ${t.grad} text-white shadow-md`
      }`}
    >
      {user ? "🧑‍🎓" : "🦉"}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-2 text-slate-400">
      <span className="thinking">
        <i /><i /><i />
      </span>
      <span className="text-xs font-bold">Tutor is thinking…</span>
    </span>
  );
}

// Compact tutor-mode picker that lives inside the composer (like a model
// selector): a small pill showing the current mode, opening an upward menu.
function ModePicker({ mode, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = MODES.find((m) => m.id === mode) || MODES[0];
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="How the tutor teaches"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-11 items-center gap-1.5 rounded-2xl px-2.5 text-xs font-extrabold transition-colors sm:px-3 ${
          open
            ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
            : "text-slate-500 hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-indigo-300"
        }`}
      >
        <span className="text-sm">{current.icon}</span>
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="msg-in absolute bottom-[3.25rem] right-0 z-30 w-60 overflow-hidden rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-slate-800">
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">How the tutor teaches</p>
          {MODES.map((m) => {
            const active = m.id === mode;
            return (
              <button key={m.id} role="menuitemradio" aria-checked={active}
                onClick={() => { onPick(m.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${
                  active ? "bg-indigo-50 dark:bg-indigo-500/15" : "hover:bg-slate-50 dark:hover:bg-white/5"
                }`}
              >
                <span className="text-base">{m.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-extrabold ${active ? "text-indigo-600 dark:text-indigo-300" : "text-slate-700 dark:text-slate-200"}`}>
                    {m.label}
                  </span>
                  <span className="block text-[11px] text-slate-400">{m.hint}</span>
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-300" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- empty state */

// Centered "session start" hero shown while the chat is still fresh: the topic
// front and center, the tutor's greeting, the learn → practice → close-gaps
// loop this screen is built around, and starter prompts to dive in.
function EmptyState({ ctx, t, greeting, onSend, onPractice, onMind, onBoard }) {
  const loopChip =
    "inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-[11px] font-extrabold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-white/10";
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-8 sm:px-6">
      <div className="msg-in w-full max-w-[44rem] text-center">
        <div className={`mx-auto grid h-16 w-16 place-items-center rounded-[1.4rem] text-3xl shadow-sm ${t.soft} ring-1 ${t.ring}`}>
          {ctx.emoji || "📘"}
        </div>
        <h1 className="mt-5 font-display text-2xl font-extrabold text-slate-900 dark:text-white sm:text-3xl">
          {ctx.topic_name}
        </h1>
        <p className="mt-1 text-xs font-bold text-slate-400">
          {ctx.subject_name}{ctx.chapter_name ? ` · ${ctx.chapter_name}` : ""}
        </p>
        {greeting && (
          <p className="mx-auto mt-4 max-w-[34rem] text-[0.95rem] leading-relaxed text-slate-500 dark:text-slate-400">
            {greeting}
          </p>
        )}

        {/* The learning loop: learn here → practice → see & close the gaps */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
          <span className={loopChip}>💡 Learn</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />
          <button onClick={onPractice} className={`${loopChip} transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm dark:hover:text-indigo-300`}>
            🎯 Practice
          </button>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />
          <button onClick={onMind} className={`${loopChip} transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm dark:hover:text-indigo-300`}>
            🧠 Close gaps
          </button>
        </div>

        <div className="mt-7 grid gap-2.5 text-left sm:grid-cols-2">
          {STARTERS(ctx.topic_name).map((s) => (
            <button key={s.label} onClick={() => onSend(s.label)}
              className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3.5 text-left text-[13px] font-extrabold text-slate-600 transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-md dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:text-indigo-300">
              <span className="text-lg">{s.icon}</span>
              <span className="min-w-0 flex-1">{s.label}</span>
              <Send className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-indigo-400" />
            </button>
          ))}
        </div>

        <button onClick={onBoard}
          className="mt-5 inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-400 transition-colors hover:text-indigo-600 dark:hover:text-indigo-300">
          <PenLine className="h-3.5 w-3.5" /> or work it out on the whiteboard
        </button>
      </div>
    </div>
  );
}

function ActionButton({ title, active, onClick, children }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${
        active ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------- fullscreen reader ---- */

// A distraction-free, borderless full-screen view of one tutor reply: just the
// content on a clean surface with a floating close button. Esc also closes.
function ResponseReader({ message, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="msg-in fixed inset-0 z-[60] overflow-y-auto bg-white dark:bg-slate-950">
      <button onClick={onClose} title="Close (Esc)" aria-label="Close"
        className="fixed right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white">
        <X className="h-5 w-5" />
      </button>
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20 xl:max-w-4xl">
        <RichMessage text={message.content} className="md-lg" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------- shortcuts overlay */

function ShortcutsOverlay({ onClose }) {
  const rows = [
    ["Enter", "Send message"],
    ["Shift + Enter", "New line"],
    [`${MOD} + Enter`, "Send message"],
    [`${MOD} + J`, "Start a new chat"],
    [`${MOD} + K`, "Search your chats"],
    ["↑", "Edit your last question"],
    ["Esc", "Stop generating"],
    ["?", "Show this help"],
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="msg-in relative w-full max-w-sm rounded-3xl border border-white/60 dark:border-white/10 bg-white dark:bg-slate-800 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
            <Keyboard className="h-4 w-4 text-indigo-500" /> Keyboard shortcuts
          </p>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 ring-1 ring-slate-200 dark:ring-white/10 hover:text-slate-600 dark:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {rows.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-xl px-1 py-1.5">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{d}</span>
              <kbd className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 px-2 py-1 text-[11px] font-extrabold text-slate-500 shadow-sm">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- session list */

function SessionList({ sessions, sessionId, onPick, t, searchRef }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((s) =>
      `${s.topic_name || ""} ${s.title || ""} ${s.subject_name || ""}`.toLowerCase().includes(needle)
    );
  }, [sessions, q]);
  const groups = useMemo(() => groupSessions(filtered), [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative px-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search chats"
          className="w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-slate-800/60 py-2 pl-8 pr-3 text-xs font-bold text-slate-600 dark:text-slate-300 outline-none placeholder:font-bold placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      <div className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">
            {sessions.length === 0 ? "Your chats will appear here." : "No chats match that search."}
          </p>
        )}
        {groups.map(([label, items]) => (
          <div key={label}>
            <p className="px-2 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{label}</p>
            <div className="space-y-1">
              {items.map((s) => {
                const active = s.id === sessionId;
                return (
                  <button
                    key={s.id}
                    onClick={() => onPick(s.id)}
                    className={`flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-colors ${
                      active ? `${t.soft} ring-1 ${t.ring}` : "hover:bg-white"
                    }`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm ${
                        active ? `bg-gradient-to-br ${t.grad} text-white` : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      <MessageSquare className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-extrabold text-slate-700 dark:text-slate-200">
                        {s.title || s.topic_name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {s.messages_count ?? 0} msgs · {relTime(s.last_message_at)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================================================================== main */

/**
 * Note Inspector — the sliding panel under the note-aware header title. Lists the
 * active uploaded notes, their AI "Main Agenda" (summary), and per-note grounded
 * quick actions (summary / flashcards / formulas).
 */
function NoteInspectorDropdown({ notes, loading, onClose, onTrigger }) {
  const perNote = [["summary", "📑 Summary"], ["flashcards", "🗂️ Flashcards"], ["cheat_sheet", "📐 Formulas"]];
  return (
    <div className="msg-in absolute left-0 top-full z-50 mt-2 w-[22rem] max-w-[90vw] rounded-3xl border border-slate-100 bg-white/95 p-4 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-white/10">
        <p className="text-xs font-extrabold uppercase tracking-wider text-indigo-500">📚 Active notes</p>
        <button onClick={onClose} className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Close</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs font-bold text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Fetching note agendas…
        </div>
      ) : notes.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">No notes loaded in this chat.</p>
      ) : (
        <div className="mt-3 max-h-80 space-y-4 overflow-y-auto">
          {notes.map((n) => (
            <div key={n.id} className="space-y-1.5 border-b border-slate-50 pb-3 last:border-0 last:pb-0 dark:border-white/5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate text-xs font-extrabold text-slate-800 dark:text-slate-200">{n.title}</span>
                {n.size_bytes ? <span className="ml-auto shrink-0 text-[10px] font-bold text-slate-400">{fmtBytes(n.size_bytes)}</span> : null}
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-white/5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Main agenda</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {n.summary || "No summary yet — tap Summary below for a clear overview."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {perNote.map(([id, label]) => (
                  <button key={id} onClick={() => onTrigger(id, n.title)}
                    className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-extrabold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Quick Study Options — a 1-tap pill carousel above the composer, shown only when
 * the session is grounded in uploaded notes. Each fires a structured, note-scoped
 * prompt the strict-grounding backend answers purely from the active notes.
 */
function QuickStudyOptionsBar({ active, onTrigger }) {
  if (!active) return null;
  const options = [
    { id: "summary",       label: "Quick Summary",    icon: <FileText className="h-3.5 w-3.5" />,                 color: "hover:bg-emerald-50 dark:hover:bg-emerald-500/10" },
    { id: "flashcards",    label: "Note Flashcards",  icon: <Sparkles className="h-3.5 w-3.5 text-amber-500" />,  color: "hover:bg-amber-50 dark:hover:bg-amber-500/10" },
    { id: "cheat_sheet",   label: "Extract Formulas", icon: <Calculator className="h-3.5 w-3.5 text-blue-500" />, color: "hover:bg-blue-50 dark:hover:bg-blue-500/10" },
    { id: "grounded_quiz", label: "Grounded Quiz",    icon: <HelpCircle className="h-3.5 w-3.5 text-rose-500" />, color: "hover:bg-rose-50 dark:hover:bg-rose-500/10" },
  ];
  return (
    <div className="no-scrollbar mb-2.5 flex items-center gap-2 overflow-x-auto pb-0.5">
      <span className="shrink-0 pr-0.5 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">From your notes</span>
      {options.map((opt) => (
        <button key={opt.id} onClick={() => onTrigger(opt.id)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-extrabold text-slate-600 transition-all active:scale-95 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300 ${opt.color}`}>
          {opt.icon}<span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function TutorChat({ session: initial, onBack, onLogout, onProgressChange }) {
  const [ctx, setCtx] = useState(initial);
  const t = tint(ctx.tint);

  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("teach");
  const [streaming, setStreaming] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const [speakingId, setSpeakingId] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [booting, setBooting] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [checklistDrawer, setChecklistDrawer] = useState(false); // mobile study-notes checklist
  const [menuOpen, setMenuOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [mind, setMind] = useState(null);            // the tutor's live "mind"
  // Side panel (Recents | Tutor's Mind) is on-demand so the chat keeps the
  // whole canvas by default. Open/closed survives reloads.
  const [sideOpen, setSideOpen] = useState(() => {
    try { return localStorage.getItem("tutorchat:sidepanel") === "open"; } catch { return false; }
  });
  const [sidePanel, setSidePanel] = useState("chats"); // Recents panel
  const [expanded, setExpanded] = useState(null);    // a reply opened in fullscreen reader
  const [snapBusy, setSnapBusy] = useState(false);   // OCR upload in flight
  const [listening, setListening] = useState(false); // voice-to-text active
  const [boardOpen, setBoardOpen] = useState(false); // whiteboard overlay
  const boardStrokes = useRef([]);                   // board survives close/reopen
  const [studyTab, setStudyTab] = useState(null);    // open Study hub at this tab (null = closed)
  const [bigAssess, setBigAssess] = useState(false); // big (exam-scope) assessment
  const [attached, setAttached] = useState([]);      // notes riding with the next message [{id,title}]
  const [inspectorOpen, setInspectorOpen] = useState(false); // note-inspector dropdown in the header
  const [activeNotes, setActiveNotes] = useState([]); // detailed records of the session's grounded notes
  const [activeNotesLoading, setActiveNotesLoading] = useState(false);
  const [examDate, setExamDate] = useState(null);    // soonest exam date for the countdown chip
  const [guide, setGuide] = useState({ planTaskTitle: null, dueCards: 0, mistakes: [] }); // "Next →" inputs
  const [checklistRefresh, setChecklistRefresh] = useState(0); // bumps when a cleared gate auto-ticks a plan task

  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const abortRef = useRef(null);
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const inspectorRef = useRef(null);
  const prevLen = useRef(0);
  const fileRef = useRef(null);   // snap-a-doubt file input
  const recRef = useRef(null);    // SpeechRecognition instance

  const loadSessions = useCallback(async () => {
    try {
      const params = ctx.topic_id ? { topic_id: ctx.topic_id } : {};
      setSessions(await tutorApi.sessions(params));
    } catch { /* ignore */ }
  }, [ctx.topic_id]);

  // Pull the tutor's live "mind" (mastery, misconceptions, memory, next step).
  const loadMind = useCallback(async (id) => {
    if (!id) return;
    try { setMind(await tutorApi.mind(id)); } catch { /* ignore */ }
  }, []);

  // Pull the bits the "Next →" guide + countdown chip need: exam date, the
  // soonest unfinished plan task, cards due, and unresolved mistakes. Cheap
  // GETs, run in parallel, never block the chat.
  const loadGuide = useCallback(async () => {
    const params = ctx.topic_id ? { topic_id: ctx.topic_id } : { topic_name: ctx.topic_name };
    try {
      const [plan, due, mistakes] = await Promise.all([
        plannerApi.index(params).catch(() => ({})),
        flashcardsApi.due(params).catch(() => []),
        mistakesApi.index(params).catch(() => []),
      ]);
      setExamDate(plan?.exam_date || null);

      // Soonest todo task scheduled for today/earlier (or undated).
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tasks = (plan?.plans || []).flatMap((p) => p.tasks || [])
        .filter((t) => t.status === "todo")
        .filter((t) => !t.scheduled_for || new Date(t.scheduled_for) <= today)
        .sort((a, b) => new Date(a.scheduled_for || 0) - new Date(b.scheduled_for || 0));

      setGuide({
        planTaskTitle: tasks[0]?.title || null,
        dueCards: Array.isArray(due) ? due.length : 0,
        mistakes: Array.isArray(mistakes) ? mistakes : [],
      });
    } catch { /* ignore */ }
  }, [ctx.topic_id, ctx.topic_name]);

  const examDaysLeft = useMemo(() => {
    if (!examDate) return null;
    const d = new Date(examDate); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  }, [examDate]);

  // The single next action for the guide pill — combines fetched guide data,
  // the live "mind" (open misconceptions), and whether a real exchange exists.
  const nextState = useMemo(() => {
    const openMisc = (mind?.misconceptions || []).filter((m) => m.status === "open");
    const fixCount = openMisc.length + (guide.mistakes?.length || 0);
    const fixTop = openMisc[0]?.description || guide.mistakes?.[0]?.concept || guide.mistakes?.[0]?.question || null;
    return {
      planTaskTitle: guide.planTaskTitle,
      dueCards: guide.dueCards,
      fixCount,
      fixTop,
      hasExchange: messages.length > 1,
    };
  }, [mind, guide, messages.length]);

  const nextHandlers = useMemo(() => ({
    onPlan: () => setStudyTab("plan"),
    onFix: () => setStudyTab("fix"),
    onCards: () => setStudyTab("cards"),
    onCheck: () => setAssessing(true),
    onAsk: () => taRef.current?.focus(),
  }), []);

  // Re-explain from the Mistake Notebook: close the hub and ask the tutor.
  const reExplain = useCallback((text) => {
    setStudyTab(null);
    send(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, streaming, attached]);

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    setSpeakingId(null);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("tutorchat:sidepanel", sideOpen ? "open" : "closed"); } catch { /* */ }
  }, [sideOpen]);

  // Opened from "Study from my notes": pin the plan checklist beside the chat.
  useEffect(() => {
    if (ctx.from_notes && window.matchMedia("(min-width: 1024px)").matches) {
      setSidePanel("checklist");
      setSideOpen(true);
    }
  }, [ctx.from_notes]);

  // Side panel: inline on desktop, drawer on mobile.
  const toggleSide = useCallback((tab) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      if (tab === "checklist") setChecklistDrawer(true); else setDrawerOpen(true);
      return;
    }
    setSideOpen((open) => {
      if (open && sidePanel === tab) return false;
      setSidePanel(tab);
      return true;
    });
  }, [sidePanel]);

  // Open (resume) the topic session on mount / when topic changes.
  useEffect(() => {
    let alive = true;
    (async () => {
      setBooting(true);
      try {
        const s = await tutorApi.start({
          topic_id: ctx.topic_id, topic_name: ctx.topic_name,
          chapter_name: ctx.chapter_name, subject_name: ctx.subject_name,
          // Carry the Notebook-Hub selection so the whole session stays grounded
          // in exactly these notes (backend stores them on the session).
          selected_note_ids: ctx.selected_note_ids || [],
        });
        if (!alive) return;
        setSessionId(s.id);
        setMessages(s.messages || []);
        setInput(loadDraft(s.id));
        loadMind(s.id);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    loadSessions();
    loadGuide();
    setAttached([]); // don't carry attachments across topics
    return () => { alive = false; abortRef.current?.abort(); stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.topic_id, ctx.topic_name]);

  // Keep pinned to the latest message while near the bottom.
  useEffect(() => {
    if (atBottom) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, atBottom]);

  // Flag new content that arrives while the student has scrolled up.
  useEffect(() => {
    if (messages.length > prevLen.current && !atBottom) setHasNew(true);
    prevLen.current = messages.length;
  }, [messages.length, atBottom]);

  // Persist the composer draft for the active session.
  useEffect(() => {
    if (!streaming) saveDraft(sessionId, input);
  }, [input, sessionId, streaming]);

  // Close the header menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Close the Note Inspector on any outside click.
  useEffect(() => {
    if (!inspectorOpen) return;
    const onDown = (e) => { if (!inspectorRef.current?.contains(e.target)) setInspectorOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [inspectorOpen]);

  // Load rich records for the session's grounded notes (titles, agendas, sizes)
  // — powers the note-aware header title and the Note Inspector dropdown.
  const groundedIdsKey = (ctx.selected_note_ids || []).join(",");
  useEffect(() => {
    const ids = ctx.selected_note_ids || [];
    if (!ids.length || !ctx.subject_name) { setActiveNotes([]); return; }
    let alive = true;
    setActiveNotesLoading(true);
    notesApi.list({ scope: "subject", subject_name: ctx.subject_name })
      .then((d) => { if (alive) setActiveNotes((d.notes || []).filter((n) => ids.includes(n.id))); })
      .catch(() => { if (alive) setActiveNotes([]); })
      .finally(() => { if (alive) setActiveNotesLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundedIdsKey, ctx.subject_name]);

  const lastUserContent = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].content;
    return "";
  }, [messages]);

  const focusComposer = useCallback((text) => {
    if (typeof text === "string") setInput(text);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    });
  }, []);

  // Global keyboard shortcuts (skip while typing, except for stop/help).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (boardOpen || studyTab) { return; } // these overlays handle their own Esc
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (inspectorOpen) { setInspectorOpen(false); return; }
        if (menuOpen) { setMenuOpen(false); return; }
        if (drawerOpen) { setDrawerOpen(false); return; }
        if (streaming) { stop(); return; }
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (window.matchMedia("(min-width: 1024px)").matches) {
          setSidePanel("chats");
          setSideOpen(true);
          requestAnimationFrame(() => searchRef.current?.focus());
        } else setDrawerOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); newChat(); return; }
      if (isTyping(e.target)) return;
      if (e.key === "?") { e.preventDefault(); setShowShortcuts(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, showShortcuts, menuOpen, drawerOpen, boardOpen, studyTab, inspectorOpen]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(near);
    if (near) setHasNew(false);
  };

  const jumpToLatest = () => {
    setAtBottom(true);
    setHasNew(false);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  // Core streaming driver: appends a pending tutor bubble and fills it live.
  const runStream = useCallback((path, body) => {
    setStreaming(true);
    setAtBottom(true);
    setMessages((m) => [...m, { role: "tutor", content: "", pending: true }]);

    const controller = new AbortController();
    abortRef.current = controller;

    const setLast = (fn) => setMessages((m) => {
      const copy = [...m];
      const i = copy.length - 1;
      if (i >= 0) copy[i] = fn(copy[i]);
      return copy;
    });

    return streamSSE(path, body, {
      onDelta: (text) => setLast((last) => ({ ...last, content: last.content + text })),
      onMind: (payload) => setMind(payload),
      onDone: (meta) => {
        setLast((last) => ({ ...last, id: meta.id, created_at: meta.created_at, pending: false }));
        setStreaming(false);
        loadSessions();
        onProgressChange?.();
      },
      onError: (msg) => {
        setLast((last) => ({
          ...last,
          pending: false,
          error: true,
          content: last.content || `⚠️ ${msg}`,
        }));
        setStreaming(false);
      },
    }, controller.signal);
  }, [loadSessions, onProgressChange]);

  const send = (text) => {
    const value = (text ?? input).trim();
    if (!value || streaming || !sessionId) return;
    stopSpeaking();
    const noteIds = attached.map((n) => n.id);
    setMessages((m) => [...m, {
      role: "user", content: value, created_at: new Date().toISOString(),
      meta: noteIds.length ? { notes: attached } : undefined,
    }]);
    setInput("");
    saveDraft(sessionId, "");
    setAttached([]); // notes attach to this one message
    if (taRef.current) taRef.current.style.height = "auto";
    runStream(`/tutor/sessions/${sessionId}/stream`, {
      message: value, mode, ...(noteIds.length ? { note_ids: noteIds } : {}),
    });
  };

  // 1-tap note study actions (header Note Inspector + Quick Study bar). Each
  // injects a structured prompt; the session is already grounded in the selected
  // notes, so the backend answers strictly from them. An optional note title
  // narrows the focus to a single note.
  const handleTriggerOption = (optionId, noteTitle = "") => {
    const ofNote = noteTitle ? ` "${noteTitle}"` : "";
    let promptText = "";
    switch (optionId) {
      case "summary":
        promptText = `Please give me a high-fidelity summary of my note${ofNote}. Break it into:\n`
          + "- 📌 **The main agenda** (the big picture in 2 sentences)\n"
          + "- 🔑 **Core concepts & definitions**\n"
          + "- 💡 **Real-world examples & analogies**";
        break;
      case "flashcards":
        promptText = `Extract 5 critical terms and definitions from my note${ofNote || "s"} and turn them into quick flashcard-style revision questions for me.`;
        break;
      case "cheat_sheet":
        promptText = `Extract all formulas, units, equations and key cheat-sheet points from my note${ofNote || "s"} and present them as a clean, copy-pasteable revision block.`;
        break;
      case "grounded_quiz":
        promptText = "Quiz me! Ask one multiple-choice question (MCQ) strictly grounded in my uploaded notes, and wait for my answer before moving to the next one.";
        break;
      default:
        return;
    }
    setInspectorOpen(false);
    send(promptText);
  };

  // Student cleared a Progress Gate. Two things happen:
  //  1) If the checkpoint covers a task in the active study plan, the backend
  //     auto-ticks it — we bump the checklist so the tick shows live.
  //  2) Nudge the tutor to stream the next part of the lesson.
  const handleQuizSuccess = (payload) => {
    const text = payload && typeof payload === "object" ? payload.question : "";
    if (text) {
      const scope = ctx.topic_id ? { topic_id: ctx.topic_id } : { topic_name: ctx.topic_name };
      plannerApi.cover({ ...scope, subject_name: ctx.subject_name, text })
        .then((r) => { if (r?.matched) { setChecklistRefresh((n) => n + 1); loadGuide(); } })
        .catch(() => { /* non-blocking */ });
    }
    if (streaming || !sessionId) return;
    send("✅ I answered the checkpoint correctly — please continue to the next part of the lesson.");
  };

  // Snap-a-doubt: photo -> OCR -> auto-send through the normal tutor flow.
  const onSnapFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || streaming || snapBusy || !sessionId) return;
    setSnapBusy(true);
    try {
      const { text } = await tutorApi.snap(file);
      send(
        "I snapped this problem from my book \u2014 please solve it step by step, teaching me as you go:\n\n" +
        text
      );
    } catch (err) {
      const msg = err?.response?.data?.message ||
        "I couldn't read that photo. Try a clearer, well-lit shot.";
      setMessages((m) => [...m, { role: "tutor", content: `\u26a0\ufe0f ${msg}`, error: true }]);
    } finally {
      setSnapBusy(false);
    }
  };

  // Whiteboard → OCR → the normal tutor flow (same rail as snap-a-doubt).
  // Throws with a friendly message so the board can show it inline.
  const askWhiteboard = async (blob) => {
    const file = new File([blob], "whiteboard.png", { type: "image/png" });
    let text = "";
    try {
      ({ text } = await tutorApi.snap(file));
    } catch (err) {
      const e = new Error("whiteboard-read-failed");
      e.userMessage = err?.response?.status === 422
        ? "I couldn't read the board — write a little larger and clearer, then ask again."
        : "Something went wrong reading the board. Please try again.";
      throw e;
    }
    setBoardOpen(false);
    send(
      "Here's my working from my whiteboard — check each step, point out any mistakes, and guide me to the next step:\n\n" +
      text
    );
  };

  // Voice-to-text via the browser's SpeechRecognition (no backend needed).
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const voiceSupported = !!SR;
  const toggleVoice = () => {
    if (!voiceSupported) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = true;
    let finalSoFar = input ? input.replace(/\s+$/, "") + " " : "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const tr = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalSoFar += tr + " ";
        else interim += tr;
      }
      setInput((finalSoFar + interim).trimStart());
      autoGrow(taRef.current);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const regenerate = () => {
    if (streaming || !sessionId) return;
    stopSpeaking();
    // Drop the trailing tutor message in the UI; the server drops it too.
    setMessages((m) => {
      const copy = [...m];
      if (copy.length && copy[copy.length - 1].role === "tutor") copy.pop();
      return copy;
    });
    runStream(`/tutor/sessions/${sessionId}/regenerate`, { mode });
  };

  // Stop generating but keep whatever streamed so far (drop an empty bubble).
  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages((m) => {
      const copy = [...m];
      const i = copy.length - 1;
      if (i >= 0 && copy[i].role === "tutor" && copy[i].pending) {
        if (copy[i].content) copy[i] = { ...copy[i], pending: false, stopped: true };
        else copy.pop();
      }
      return copy;
    });
  };

  const switchSession = async (id) => {
    setDrawerOpen(false);
    if (id === sessionId) return;
    abortRef.current?.abort();
    stopSpeaking();
    setStreaming(false);
    setBooting(true);
    try {
      const s = await tutorApi.show(id);
      setSessionId(s.id);
      setMessages(s.messages || []);
      setInput(loadDraft(s.id));
      loadMind(s.id);
      setCtx((c) => ({
        ...c,
        topic_id: s.topic_id ?? c.topic_id,
        topic_name: s.topic_name || c.topic_name,
        chapter_name: s.chapter_name || c.chapter_name,
        subject_name: s.subject_name || c.subject_name,
      }));
    } finally { setBooting(false); }
  };

  const newChat = async () => {
    setDrawerOpen(false);
    setMenuOpen(false);
    abortRef.current?.abort();
    stopSpeaking();
    setStreaming(false);
    setBooting(true);
    try {
      const s = await tutorApi.start({
        topic_id: ctx.topic_id, topic_name: ctx.topic_name,
        chapter_name: ctx.chapter_name, subject_name: ctx.subject_name,
        selected_note_ids: ctx.selected_note_ids || [], fresh: true,
      });
      setSessionId(s.id);
      setMessages(s.messages || []);
      setInput(loadDraft(s.id));
      loadMind(s.id);
      loadSessions();
    } finally { setBooting(false); }
  };

  const copy = async (text, id) => {
    try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); } catch { /* */ }
  };

  // Rename the active chat (shows in the recent-chats list).
  const renameChat = async () => {
    setMenuOpen(false);
    const current = sessions.find((x) => x.id === sessionId);
    const title = window.prompt("Rename this chat:", current?.title || ctx.topic_name || "");
    if (!title || !title.trim()) return;
    try {
      await tutorApi.rename(sessionId, title.trim());
      loadSessions();
    } catch { /* ignore */ }
  };

  const copyTranscript = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(buildTranscript(ctx, messages));
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 1800);
    } catch { /* */ }
  };

  const exportTranscript = () => {
    setMenuOpen(false);
    try {
      const blob = new Blob([buildTranscript(ctx, messages)], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = (ctx.topic_name || "tutor-chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      a.href = url;
      a.download = `${slug || "tutor-chat"}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* */ }
  };

  const rate = (msg, rating) => {
    if (!msg.id) return;
    const next = msg.meta?.rating === rating ? "none" : rating;
    setMessages((m) => m.map((x) => x.id === msg.id ? { ...x, meta: { ...x.meta, rating: next === "none" ? null : next } } : x));
    tutorApi.feedback(msg.id, next).catch(() => { /* ignore */ });
  };

  // Read a tutor answer aloud (toggle). Uses the browser's speech synthesis.
  const speak = (msg) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (speakingId === (msg.id ?? msg)) { stopSpeaking(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(speakable(msg.content));
    u.rate = 1; u.pitch = 1;
    u.onend = () => setSpeakingId(null);
    u.onerror = () => setSpeakingId(null);
    setSpeakingId(msg.id ?? msg);
    synth.speak(u);
  };

  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const lastTutorIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "tutor") return i;
    return -1;
  })();
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
    return -1;
  })();
  const showStarters = messages.length <= 1 && !streaming && !booting;
  // The opening line for the hero — the tutor's greeting, sans markdown bold.
  const greeting = useMemo(() => {
    const first = messages[0];
    if (!first || first.role !== "tutor" || !first.content) {
      return "Ask me anything about this topic — I'll explain it step by step.";
    }
    return first.content.replace(/\*\*/g, "");
  }, [messages]);
  // Show follow-up chips once a real exchange exists and the tutor is idle.
  const lastMsg = messages[messages.length - 1];
  const showFollowups =
    !showStarters && !streaming && !booting && messages.length > 1 &&
    lastMsg && lastMsg.role === "tutor" && lastMsg.content && !lastMsg.error;

  // Header icon-toggle styling: lit while its panel tab is open (desktop).
  const headerToggle = (active) =>
    `grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 transition-colors ${
      active
        ? "bg-indigo-50 text-indigo-600 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30"
        : "text-slate-500 ring-slate-200 hover:text-indigo-600 dark:ring-white/10 dark:text-slate-300 dark:hover:text-indigo-300"
    }`;

  // Note-grounded sessions get a note-aware header: the active note's name (plus
  // "+N more") instead of the opaque "Science / Science" topic label.
  const noteCount = (ctx.selected_note_ids || []).length;
  const hasNotes = noteCount > 0;
  const extraNotes = (activeNotes.length || noteCount) - 1;
  // Topic is the headline; the note/PDF name(s) ride along in the subtitle.
  const headerTitle = ctx.topic_name;
  const notesLabel = hasNotes
    ? (activeNotes[0]?.title || `${noteCount} note${noteCount > 1 ? "s" : ""}`)
      + (extraNotes > 0 ? ` + ${extraNotes} more note${extraNotes > 1 ? "s" : ""}` : "")
    : "";

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* Chat canvas — the hero. Full-bleed, content centered to a reading column. */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* Slim header */}
          <div className="flex items-center gap-2 border-b border-slate-200/60 bg-white/60 px-3 py-2.5 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/50 sm:gap-2.5 sm:px-4">
            <button onClick={onBack} title="All topics" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-indigo-600 dark:text-slate-300 dark:ring-white/10 dark:hover:text-indigo-300">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className={`hidden h-9 w-9 shrink-0 place-items-center rounded-xl text-lg sm:grid ${t.soft}`}>{ctx.emoji || "📘"}</div>
            <div className="relative min-w-0 flex-1" ref={inspectorRef}>
              {hasNotes ? (
                <button
                  onClick={() => setInspectorOpen((v) => !v)}
                  title="View the notes this chat is grounded in"
                  className="flex max-w-full items-center gap-1 text-left"
                >
                  <span className="truncate text-sm font-extrabold leading-tight text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400">{headerTitle}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${inspectorOpen ? "rotate-180" : ""}`} />
                </button>
              ) : (
                <p className="truncate text-sm font-extrabold leading-tight text-slate-900 dark:text-white">{headerTitle}</p>
              )}
              <p className="truncate text-[11px] font-bold text-slate-400">{ctx.subject_name}{ctx.chapter_name ? ` · ${ctx.chapter_name}` : ""}{notesLabel ? ` · ${notesLabel}` : ""}</p>
              {inspectorOpen && hasNotes && (
                <NoteInspectorDropdown
                  notes={activeNotes}
                  loading={activeNotesLoading}
                  onClose={() => setInspectorOpen(false)}
                  onTrigger={(type, title) => handleTriggerOption(type, title)}
                />
              )}
            </div>
            <span className={`hidden items-center gap-1.5 rounded-full ${t.soft} px-2.5 py-1 text-[11px] font-extrabold ${t.text} xl:inline-flex`}>
              <ShieldCheck className="h-3.5 w-3.5" /> {hasNotes ? "Notes-grounded" : "Topic-scoped"}
            </span>
            {/* Exam countdown — opens the planner */}
            {examDaysLeft !== null && examDaysLeft >= 0 && (
              <button onClick={() => setStudyTab("plan")} title="Open your exam plan"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-600 transition-colors hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <CalendarClock className="h-3.5 w-3.5" />
                {examDaysLeft === 0 ? "Exam today" : `${examDaysLeft}d to exam`}
              </button>
            )}
            <button onClick={() => setStudyTab("plan")} title="Study hub — notes, planner, flashcards"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br ${t.grad} px-3 py-2 text-xs font-extrabold text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]`}>
              <SparklesIcon className="h-4 w-4" /> <span className="hidden sm:inline">Study</span>
            </button>
            <button onClick={() => setAssessing(true)} title="Check understanding"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-indigo-600 dark:text-slate-300 dark:ring-white/10 dark:hover:text-indigo-300">
              <ClipboardCheck className="h-5 w-5" />
            </button>
            {/* Study-from-notes: the plan checklist, pinned beside the chat */}
            {ctx.from_notes && (
              <button onClick={() => toggleSide("checklist")} title="My study-notes checklist"
                className={headerToggle(sideOpen && sidePanel === "checklist")}>
                <ListChecks className="h-5 w-5" />
              </button>
            )}
            <div className="mx-0.5 hidden h-6 w-px shrink-0 bg-slate-200 dark:bg-white/10 sm:block" />
            <button onClick={() => toggleSide("chats")} title="Recent chats"
              className={headerToggle(sideOpen && sidePanel === "chats")}>
              <History className="h-5 w-5" />
            </button>

            {/* Overflow menu */}
            <div className="relative shrink-0" ref={menuRef}>
              <button onClick={() => setMenuOpen((v) => !v)} title="More" aria-haspopup="menu" aria-expanded={menuOpen}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 dark:ring-white/10 hover:text-indigo-600">
                <MoreVertical className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div className="msg-in absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-2xl border border-slate-100 dark:border-white/10 bg-white dark:bg-slate-800 p-1.5 shadow-xl">
                  <button onClick={newChat} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5">
                    <Plus className="h-4 w-4 text-slate-400" /> New chat
                  </button>
                  <button onClick={renameChat} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5">
                    <Pencil className="h-4 w-4 text-slate-400" /> Rename chat
                  </button>
                  <button onClick={copyTranscript} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5">
                    {copiedTranscript ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4 text-slate-400" />}
                    {copiedTranscript ? "Copied!" : "Copy transcript"}
                  </button>
                  <button onClick={exportTranscript} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5">
                    <Download className="h-4 w-4 text-slate-400" /> Export as Markdown
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-white/10" />
                  <button onClick={() => { setMenuOpen(false); setShowShortcuts(true); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5">
                    <Keyboard className="h-4 w-4 text-slate-400" /> Keyboard shortcuts
                  </button>
                </div>
              )}
            </div>

            {/* Global controls — folded in so the chat needs only one header */}
            <div className="mx-0.5 hidden h-6 w-px shrink-0 bg-slate-200 dark:bg-white/10 lg:block" />
            <CreditMeter className="hidden shrink-0 lg:flex" />
            <ThemeToggle className="shrink-0" />
            <button onClick={onLogout} title="Log out"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-rose-500 dark:text-slate-300 dark:ring-white/10 dark:hover:text-rose-400">
              <LogOut className="h-5 w-5" />
            </button>
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
            {!booting && <FigureStrip ctx={ctx} />}
            {booting ? (
              <div className="flex h-full items-center justify-center gap-3 text-slate-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
                <span className="text-sm font-bold">Opening your chat…</span>
              </div>
            ) : showStarters ? (
              <EmptyState
                ctx={ctx} t={t} greeting={greeting} onSend={send}
                onPractice={() => setAssessing(true)}
                onMind={() => setStudyTab("fix")}
                onBoard={() => setBoardOpen(true)}
              />
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-8 px-4 pb-10 pt-8 sm:px-6 xl:max-w-4xl 2xl:max-w-5xl">
                {messages.map((m, i) => {
                  const isUser = m.role === "user";
                  const isLastTutor = i === lastTutorIdx;
                  const isLastUser = i === lastUserIdx;
                  const showActions = !isUser && !m.pending && m.content && !m.error;
                  const thinking = m.pending && !m.content;

                  // The student's turn: a compact bubble on the right.
                  if (isUser) {
                    return (
                      <div key={m.id ?? `tmp-${i}`} className="msg-in flex justify-end">
                        <div className="group flex min-w-0 max-w-[85%] flex-col items-end gap-1 sm:max-w-[75%]">
                          {Array.isArray(m.meta?.notes) && m.meta.notes.length > 0 && (
                            <div className="flex flex-wrap justify-end gap-1">
                              {m.meta.notes.map((n) => (
                                <span key={n.id} className="inline-flex max-w-[12rem] items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-extrabold text-indigo-500 ring-1 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30">
                                  <Paperclip className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{n.title}</span>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className={`rounded-3xl rounded-br-lg bg-gradient-to-br ${t.grad} px-4 py-2.5 text-[0.95rem] leading-relaxed text-white shadow-sm shadow-indigo-500/20`}>
                            <p className="whitespace-pre-wrap">{m.content}</p>
                          </div>
                          {isLastUser && !streaming && (
                            <button onClick={() => focusComposer(m.content)} title="Edit this question"
                              className="flex items-center gap-1 px-1 text-[11px] font-extrabold text-slate-400 opacity-0 transition-opacity hover:text-indigo-600 group-hover:opacity-100">
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // The tutor's turn: open text on the canvas — no bubble, so
                  // long explanations read like a page, not a chat scrap.
                  return (
                    <div key={m.id ?? `tmp-${i}`} className="msg-in flex gap-3 sm:gap-4">
                      <Avatar t={t} />
                      <div className="group min-w-0 flex-1 pt-1">
                        {thinking ? (
                          <ThinkingDots />
                        ) : m.error ? (
                          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-[0.95rem] leading-relaxed text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                            <p className="whitespace-pre-wrap">{m.content}</p>
                          </div>
                        ) : (
                          <RichMessage text={m.content} streaming={m.pending} className="md-lg" persistScope={sessionId} onQuizSuccess={handleQuizSuccess} />
                        )}
                        {m.stopped && (
                          <p className="mt-1.5 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Stopped</p>
                        )}
                        {showActions && (
                          <div className="-ml-1 mt-2 flex items-center gap-0.5">
                            <ActionButton title="Open in full screen" onClick={() => setExpanded(m)}>
                              <Maximize2 className="h-3.5 w-3.5" />
                            </ActionButton>
                            <ActionButton title="Copy" active={copiedId === (m.id ?? i)} onClick={() => copy(m.content, m.id ?? i)}>
                              {copiedId === (m.id ?? i) ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            </ActionButton>
                            {ttsSupported && (
                              <ActionButton title={speakingId === (m.id ?? i) ? "Stop reading" : "Read aloud"} active={speakingId === (m.id ?? i)} onClick={() => speak(m.id ? m : { ...m, id: i })}>
                                {speakingId === (m.id ?? i) ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                              </ActionButton>
                            )}
                            {i > 0 && m.id && (
                              <>
                                <ActionButton title="Good answer" active={m.meta?.rating === "up"} onClick={() => rate(m, "up")}><ThumbsUp className="h-3.5 w-3.5" /></ActionButton>
                                <ActionButton title="Needs work" active={m.meta?.rating === "down"} onClick={() => rate(m, "down")}><ThumbsDown className="h-3.5 w-3.5" /></ActionButton>
                              </>
                            )}
                            {isLastTutor && i > 0 && (
                              <ActionButton title="Regenerate" onClick={regenerate}><RefreshCw className="h-3.5 w-3.5" /></ActionButton>
                            )}
                          </div>
                        )}
                        {/* Regenerate affordance for an errored last reply */}
                        {m.error && isLastTutor && (
                          <button onClick={regenerate} className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-extrabold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                            <RefreshCw className="h-3.5 w-3.5" /> Try again
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!atBottom && (
            <button onClick={jumpToLatest} title="Jump to latest"
              className="absolute bottom-36 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white dark:bg-slate-800 px-3 py-2 text-xs font-extrabold text-slate-500 shadow-lg ring-1 ring-slate-200 dark:ring-white/10 transition-colors hover:text-indigo-600">
              {hasNew ? <span className={`h-2 w-2 rounded-full ${t.dot} animate-pulse`} /> : <ArrowDown className="h-4 w-4" />}
              {hasNew ? "New reply" : "Latest"}
            </button>
          )}

          {/* Composer block — same reading column as the messages */}
          <div className="px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
            <div className="mx-auto w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl">
            {/* Study-from-notes: 1-tap grounded actions (summary, flashcards,
                formulas, grounded quiz) drawn strictly from the active notes. */}
            <QuickStudyOptionsBar active={hasNotes} onTrigger={handleTriggerOption} />
            {/* One guiding nudge + contextual follow-ups, on a single scrollable
                strip so the composer stays close to the conversation. */}
            {(!showStarters || showFollowups) && (
              <div className="no-scrollbar mb-2.5 flex items-center gap-2 overflow-x-auto pb-0.5">
                {!showStarters && (
                  <NextStep state={nextState} handlers={nextHandlers} className="shrink-0" />
                )}
                {/* Follow-up suggestion chips — hidden in study-with-notes sessions. */}
                {showFollowups && !hasNotes && FOLLOWUPS.map((s) => (
                  <button key={s.label} onClick={() => send(s.label)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-slate-800/60 px-3 py-1.5 text-xs font-extrabold text-slate-600 dark:text-slate-300 transition-colors hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm">
                    <span>{s.icon}</span> {s.label}
                  </button>
                ))}
              </div>
            )}

            {/* Notes attached to the next message */}
            {attached.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attached.map((n) => (
                  <span key={n.id} className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-extrabold text-indigo-600 ring-1 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30">
                    <Paperclip className="h-3 w-3 shrink-0" />
                    <span className="truncate">{n.title}</span>
                    <button onClick={() => setAttached((a) => a.filter((x) => x.id !== n.id))} title="Remove" className="shrink-0 hover:text-indigo-800 dark:hover:text-white">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-end gap-1.5 rounded-[1.75rem] bg-white dark:bg-slate-800 p-2 shadow-lg shadow-slate-200/60 dark:shadow-black/20 ring-1 ring-slate-200 dark:ring-white/10 transition-shadow focus-within:ring-2 focus-within:ring-indigo-300 sm:gap-2">
              {/* Attach notes (upload + select) — rides with the next message */}
              <NotesPicker
                ctx={ctx}
                grad={t.grad}
                selectedIds={attached.map((n) => n.id)}
                onToggle={(note) => setAttached((a) =>
                  a.some((x) => x.id === note.id)
                    ? a.filter((x) => x.id !== note.id)
                    : [...a, { id: note.id, title: note.title }])}
              />
              {/* Snap-a-doubt: photo -> OCR -> tutor solves it teaching-style */}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onSnapFile} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={streaming || snapBusy}
                title="Snap a doubt (photo of a problem)"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-white/5 hover:text-indigo-600 disabled:opacity-40"
              >
                {snapBusy
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
                  : <Camera className="h-5 w-5" />}
              </button>
              {/* Whiteboard: sketch your working, the tutor reads the board */}
              <button
                onClick={() => setBoardOpen(true)}
                disabled={streaming || snapBusy}
                title="Open the whiteboard"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-white/5 hover:text-indigo-600 disabled:opacity-40"
              >
                <PenLine className="h-5 w-5" />
              </button>
              {voiceSupported && (
                <button
                  onClick={toggleVoice}
                  disabled={streaming}
                  title={listening ? "Stop listening" : "Speak your question"}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-colors disabled:opacity-40 ${
                    listening ? "bg-rose-50 text-rose-500 ring-1 ring-rose-200 animate-pulse" : "text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-indigo-600"
                  }`}
                >
                  {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
              )}
              <textarea ref={taRef} rows={1} value={input}
                onChange={(e) => { setInput(e.target.value); autoGrow(e.target); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); return; }
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); return; }
                  if (e.key === "ArrowUp" && !input && !streaming && lastUserContent) { e.preventDefault(); focusComposer(lastUserContent); }
                }}
                placeholder={`Ask anything about ${ctx.topic_name}…`}
                className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-400" />
              {/* Tutor mode lives inside the composer to keep the canvas clean */}
              <ModePicker mode={mode} onPick={setMode} />
              {streaming ? (
                <button onClick={stop} title="Stop generating (Esc)"
                  className="group grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-800 text-white shadow-lg transition-transform active:scale-95">
                  <Square className="h-4 w-4 fill-current" />
                </button>
              ) : (
                <button onClick={() => send()} disabled={!input.trim()} title="Send (Enter)"
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${t.grad} text-white shadow-lg shadow-indigo-500/30 transition-transform active:scale-95 disabled:opacity-40`}>
                  <Send className="h-5 w-5" />
                </button>
              )}
            </div>
            <p className="mt-2 flex items-center justify-center gap-1.5 px-2 text-center text-[11px] text-slate-400">
              <Sparkles className="h-3 w-3" /> {hasNotes ? <>Grounded in <b>{noteCount} of your note{noteCount > 1 ? "s" : ""}</b></> : <>Scoped to <b>{ctx.topic_name}</b></>}
              <span className="hidden sm:inline">· Shift+Enter for a new line ·</span>
              <button onClick={() => setShowShortcuts(true)} className="hidden font-extrabold text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-indigo-600 sm:inline">shortcuts</button>
            </p>
            </div>
          </div>
        </main>

        {/* RIGHT: on-demand Recents panel. Collapsed by default so the chat
            owns the canvas; opens from the header History toggle. */}
        <aside
          className="hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out lg:block"
          style={{ width: sideOpen ? "21.5rem" : "0rem" }}
          aria-hidden={!sideOpen}
        >
          <div className="flex h-full w-[21.5rem] flex-col border-l border-slate-200/60 bg-white/55 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/50">
          <div className="flex items-center gap-2 px-3 pt-3">
            <p className="flex flex-1 items-center gap-1.5 px-1 text-xs font-extrabold text-slate-600 dark:text-slate-300">
              {sidePanel === "checklist"
                ? <><ListChecks className="h-4 w-4 text-indigo-500" /> My study plan</>
                : <><History className="h-4 w-4 text-indigo-500" /> Recent chats</>}
            </p>
            <button onClick={() => setSideOpen(false)} title="Hide panel"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-slate-400 ring-1 ring-slate-200 transition-colors hover:text-slate-600 dark:text-slate-300 dark:ring-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Panel body */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
            {sidePanel === "checklist" ? (
              <NotesChecklist topicName={ctx.topic_name} chapterName={ctx.chapter_name} subjectName={ctx.subject_name || ctx.topic_name} noteIds={ctx.selected_note_ids || []} grad={t.grad} onPrompt={(text) => send(text)} refreshKey={checklistRefresh} />
            ) : (
              <>
                <button onClick={newChat} className={`mb-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${t.grad} px-3 py-2.5 text-sm font-extrabold text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]`}>
                  <Plus className="h-4 w-4" /> New chat
                  <span className="ml-auto hidden rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-extrabold xl:inline">{MOD} J</span>
                </button>
                <SessionList sessions={sessions} sessionId={sessionId} onPick={switchSession} t={t} searchRef={searchRef} />
              </>
            )}
          </div>
          </div>
        </aside>
      </div>

      {/* Mobile history drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="drawer-in absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col gap-3 bg-gradient-to-b from-slate-50 to-indigo-50/60 p-4 shadow-2xl dark:from-slate-900 dark:to-slate-950">
            <div className="flex items-center justify-between">
              <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Chat history</p>
              <button onClick={() => setDrawerOpen(false)} className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 dark:ring-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
            <button onClick={newChat} className={`inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${t.grad} px-3 py-2.5 text-sm font-extrabold text-white shadow-md`}>
              <Plus className="h-4 w-4" /> New chat
            </button>
            <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-white/60 dark:border-white/10 bg-white/70 p-3 backdrop-blur-sm">
              <SessionList sessions={sessions} sessionId={sessionId} onPick={switchSession} t={t} />
            </div>
          </div>
        </div>
      )}

      {/* Mobile study-notes checklist drawer (right side) */}
      {checklistDrawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setChecklistDrawer(false)} />
          <div className="drawer-in absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col gap-3 bg-gradient-to-b from-slate-50 to-indigo-50/60 p-4 shadow-2xl dark:from-slate-900 dark:to-slate-950">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-700 dark:text-slate-200"><ListChecks className="h-4 w-4 text-indigo-500" /> My study plan</p>
              <button onClick={() => setChecklistDrawer(false)} className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 dark:ring-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NotesChecklist topicName={ctx.topic_name} chapterName={ctx.chapter_name} subjectName={ctx.subject_name || ctx.topic_name} noteIds={ctx.selected_note_ids || []} grad={t.grad} onPrompt={(text) => send(text)} refreshKey={checklistRefresh} />
            </div>
          </div>
        </div>
      )}

      {/* Passive screen-time tracking for the active topic (feeds the AI mind) */}
      <ScreenTimeTracker topicName={ctx.topic_name} topicId={ctx.topic_id} />

      {/* Built-in whiteboard: sketch the working, send it to the tutor */}
      {boardOpen && (
        <Whiteboard
          topicName={ctx.topic_name}
          grad={t.grad}
          initialStrokes={boardStrokes.current}
          onChange={(s) => { boardStrokes.current = s; }}
          onAsk={askWhiteboard}
          onClose={() => setBoardOpen(false)}
        />
      )}

      {/* Full-screen reading view for a single response — borderless, content only */}
      {expanded && <ResponseReader message={expanded} onClose={() => setExpanded(null)} />}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

      {assessing && (
        <AssessmentFlow
          topicName={ctx.topic_name}
          topicId={ctx.topic_id}
          sessionId={sessionId}
          onClose={() => { setAssessing(false); loadMind(sessionId); loadGuide(); onProgressChange?.(); }}
          onSeeWork={() => { setAssessing(false); loadMind(sessionId); loadGuide(); onProgressChange?.(); setStudyTab("fix"); }}
        />
      )}

      {/* Big (exam-scope) assessment launched from the planner */}
      {bigAssess && (
        <AssessmentFlow
          topicName={ctx.topic_name}
          topicId={ctx.topic_id}
          sessionId={sessionId}
          scope="exam"
          onClose={() => { setBigAssess(false); loadMind(sessionId); loadGuide(); onProgressChange?.(); }}
          onSeeWork={() => { setBigAssess(false); loadMind(sessionId); loadGuide(); onProgressChange?.(); setStudyTab("fix"); }}
        />
      )}

      {/* Study hub: plan · what to work on · notes · cards */}
      {studyTab && (
        <StudyHub
          ctx={ctx}
          grad={t.grad}
          initialTab={studyTab}
          mind={mind}
          onClose={() => { setStudyTab(null); loadGuide(); }}
          onBigAssessment={() => { setStudyTab(null); setBigAssess(true); }}
          onReExplain={reExplain}
        />
      )}
    </div>
  );
}
