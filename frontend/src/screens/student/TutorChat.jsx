import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Send, Square, Lightbulb, ClipboardCheck, Sparkles,
  Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, Plus, MessageSquare,
  ChevronDown, Search, X, Volume2, VolumeX, History, ShieldCheck,
  Pencil, MoreVertical, Download, Keyboard, ArrowDown,
  Brain, Mic, MicOff, Camera,
} from "lucide-react";
import { tint } from "../../ui/tints.js";
import { tutorApi } from "../../api/endpoints.js";
import { streamSSE } from "../../api/stream.js";
import Markdown from "../../ui/Markdown.jsx";
import RichMessage from "../../ui/RichMessage.jsx";
import AssessmentFlow from "./AssessmentFlow.jsx";
import TutorMind from "./TutorMind.jsx";

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
        user ? "bg-white ring-1 ring-slate-200" : `bg-gradient-to-br ${t.grad} text-white shadow-md`
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

function Bubble({ m, isUser, t }) {
  const thinking = m.pending && !m.content;
  return (
    <div
      className={`max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
        isUser
          ? `rounded-tr-md bg-gradient-to-br ${t.grad} text-white`
          : m.error
          ? "rounded-tl-md border border-rose-100 bg-rose-50 text-rose-700"
          : "rounded-tl-md border border-slate-100 bg-white text-slate-700"
      }`}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap">{m.content}</p>
      ) : thinking ? (
        <ThinkingDots />
      ) : (
        <RichMessage text={m.content} streaming={m.pending} />
      )}
      {m.stopped && (
        <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Stopped
        </p>
      )}
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
        active ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      }`}
    >
      {children}
    </button>
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
      <div className="msg-in relative w-full max-w-sm rounded-3xl border border-white/60 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
            <Keyboard className="h-4 w-4 text-indigo-500" /> Keyboard shortcuts
          </p>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 ring-1 ring-slate-200 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {rows.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-xl px-1 py-1.5">
              <span className="text-xs font-bold text-slate-600">{d}</span>
              <kbd className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-extrabold text-slate-500 shadow-sm">{k}</kbd>
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
          className="w-full rounded-2xl border border-slate-200 bg-white/80 py-2 pl-8 pr-3 text-xs font-bold text-slate-600 outline-none placeholder:font-bold placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
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
                      <span className="block truncate text-xs font-extrabold text-slate-700">
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

export default function TutorChat({ session: initial, onBack, onProgressChange }) {
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [mind, setMind] = useState(null);            // the tutor's live "mind"
  const [mindOpen, setMindOpen] = useState(true);    // right panel (desktop xl)
  const [mindSheet, setMindSheet] = useState(false); // bottom sheet (mobile)
  const [snapBusy, setSnapBusy] = useState(false);   // OCR upload in flight
  const [listening, setListening] = useState(false); // voice-to-text active

  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const abortRef = useRef(null);
  const searchRef = useRef(null);
  const menuRef = useRef(null);
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

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    setSpeakingId(null);
  }, []);

  // Open (resume) the topic session on mount / when topic changes.
  useEffect(() => {
    let alive = true;
    (async () => {
      setBooting(true);
      try {
        const s = await tutorApi.start({
          topic_id: ctx.topic_id, topic_name: ctx.topic_name,
          chapter_name: ctx.chapter_name, subject_name: ctx.subject_name,
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
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (menuOpen) { setMenuOpen(false); return; }
        if (drawerOpen) { setDrawerOpen(false); return; }
        if (streaming) { stop(); return; }
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (window.matchMedia("(min-width: 1024px)").matches) searchRef.current?.focus();
        else setDrawerOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); newChat(); return; }
      if (isTyping(e.target)) return;
      if (e.key === "?") { e.preventDefault(); setShowShortcuts(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, showShortcuts, menuOpen, drawerOpen]);

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
    setMessages((m) => [...m, { role: "user", content: value, created_at: new Date().toISOString() }]);
    setInput("");
    saveDraft(sessionId, "");
    if (taRef.current) taRef.current.style.height = "auto";
    runStream(`/tutor/sessions/${sessionId}/stream`, { message: value, mode });
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
        chapter_name: ctx.chapter_name, subject_name: ctx.subject_name, fresh: true,
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
  // Show follow-up chips once a real exchange exists and the tutor is idle.
  const lastMsg = messages[messages.length - 1];
  const showFollowups =
    !showStarters && !streaming && !booting && messages.length > 1 &&
    lastMsg && lastMsg.role === "tutor" && lastMsg.content && !lastMsg.error;

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      <div className="mx-auto flex w-full max-w-[88rem] flex-1 gap-5 overflow-hidden px-4 py-5">
        {/* Context + history rail (desktop) */}
        <aside className="hidden w-72 shrink-0 flex-col gap-4 lg:flex">
          <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 hover:text-indigo-600">
            <ArrowLeft className="h-4 w-4" /> Topics
          </button>

          <div className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-lg shadow-slate-200/40 backdrop-blur-sm">
            <div className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${t.soft}`}>{ctx.emoji || "📘"}</div>
            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">{ctx.subject_name} · {ctx.chapter_name}</p>
            <h2 className="mt-1 text-lg font-extrabold leading-snug text-slate-900">{ctx.topic_name}</h2>
            <button onClick={() => setAssessing(true)} className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${t.grad} px-3 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl active:scale-[0.98]`}>
              <ClipboardCheck className="h-4 w-4" /> Check my understanding
            </button>
            <button onClick={newChat} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-extrabold text-slate-600 ring-1 ring-slate-200 transition-all hover:text-indigo-600 active:scale-[0.98]">
              <Plus className="h-4 w-4" /> New chat
              <span className="ml-auto hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-extrabold text-slate-400 xl:inline">{MOD} J</span>
            </button>
          </div>

          {/* Recent chats */}
          <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-white/60 bg-white/60 p-3 backdrop-blur-sm">
            <p className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-400">Recent chats</p>
            <SessionList sessions={sessions} sessionId={sessionId} onPick={switchSession} t={t} searchRef={searchRef} />
          </div>

          <div className="rounded-3xl border border-white/60 bg-white/60 p-4 text-sm text-slate-500 backdrop-blur-sm">
            <p className="flex items-center gap-2 font-extrabold text-slate-700"><Lightbulb className="h-4 w-4 text-amber-500" /> Tip</p>
            <p className="mt-1.5 text-xs">Ask “why”, not just “what”. The tutor explains the reasoning with worked steps and math.</p>
          </div>
        </aside>

        {/* Chat column */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/50 shadow-xl shadow-slate-200/50 backdrop-blur-sm">
          {/* Unified header */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <button onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 hover:text-indigo-600 lg:hidden">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className={`hidden h-10 w-10 shrink-0 place-items-center rounded-2xl text-xl sm:grid ${t.soft}`}>{ctx.emoji || "📘"}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold leading-tight text-slate-900">{ctx.topic_name}</p>
              <p className="truncate text-[11px] font-bold text-slate-400">{ctx.subject_name}{ctx.chapter_name ? ` · ${ctx.chapter_name}` : ""}</p>
            </div>
            <span className={`hidden items-center gap-1.5 rounded-full ${t.soft} px-2.5 py-1 text-[11px] font-extrabold ${t.text} sm:inline-flex`}>
              <ShieldCheck className="h-3.5 w-3.5" /> Topic-scoped
            </span>
            <button onClick={() => setDrawerOpen(true)} title="Chat history" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 hover:text-indigo-600 lg:hidden">
              <History className="h-5 w-5" />
            </button>
            {/* Tutor's mind: side panel on desktop, bottom sheet on mobile */}
            <button
              onClick={() => (window.matchMedia("(min-width: 1280px)").matches ? setMindOpen((v) => !v) : setMindSheet(true))}
              title="Tutor's mind"
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 transition-colors ${
                mindOpen ? "bg-indigo-50 text-indigo-600 ring-indigo-200" : "text-slate-500 ring-slate-200 hover:text-indigo-600"
              }`}
            >
              <Brain className="h-5 w-5" />
            </button>
            <button onClick={() => setAssessing(true)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br ${t.grad} px-3 py-2 text-xs font-extrabold text-white shadow-md`}>
              <ClipboardCheck className="h-4 w-4" /> <span className="hidden sm:inline">Check understanding</span><span className="sm:hidden">Quiz</span>
            </button>

            {/* Overflow menu */}
            <div className="relative shrink-0" ref={menuRef}>
              <button onClick={() => setMenuOpen((v) => !v)} title="More" aria-haspopup="menu" aria-expanded={menuOpen}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 hover:text-indigo-600">
                <MoreVertical className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div className="msg-in absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl">
                  <button onClick={newChat} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 hover:bg-slate-50">
                    <Plus className="h-4 w-4 text-slate-400" /> New chat
                  </button>
                  <button onClick={renameChat} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 hover:bg-slate-50">
                    <Pencil className="h-4 w-4 text-slate-400" /> Rename chat
                  </button>
                  <button onClick={copyTranscript} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 hover:bg-slate-50">
                    {copiedTranscript ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4 text-slate-400" />}
                    {copiedTranscript ? "Copied!" : "Copy transcript"}
                  </button>
                  <button onClick={exportTranscript} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 hover:bg-slate-50">
                    <Download className="h-4 w-4 text-slate-400" /> Export as Markdown
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <button onClick={() => { setMenuOpen(false); setShowShortcuts(true); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-600 hover:bg-slate-50">
                    <Keyboard className="h-4 w-4 text-slate-400" /> Keyboard shortcuts
                  </button>
                </div>
              )}
            </div>
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-5">
            {booting ? (
              <div className="flex items-center gap-3 text-slate-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
                <span className="text-sm font-bold">Opening your chat…</span>
              </div>
            ) : messages.map((m, i) => {
              const isUser = m.role === "user";
              const isLastTutor = i === lastTutorIdx;
              const isLastUser = i === lastUserIdx;
              const showActions = !isUser && !m.pending && m.content && !m.error;
              return (
                <div key={m.id ?? `tmp-${i}`} className={`msg-in flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
                  <Avatar user={isUser} t={t} />
                  <div className={`group flex min-w-0 flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
                    <Bubble m={m} isUser={isUser} t={t} />
                    {/* Edit / reuse your last question */}
                    {isUser && isLastUser && !streaming && (
                      <button onClick={() => focusComposer(m.content)} title="Edit this question"
                        className="flex items-center gap-1 px-1 text-[11px] font-extrabold text-slate-400 opacity-0 transition-opacity hover:text-indigo-600 group-hover:opacity-100">
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    )}
                    {showActions && (
                      <div className="flex items-center gap-0.5 px-1">
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
                    {!isUser && m.error && isLastTutor && (
                      <button onClick={regenerate} className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-extrabold text-rose-600 hover:bg-rose-50">
                        <RefreshCw className="h-3.5 w-3.5" /> Try again
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!atBottom && (
            <button onClick={jumpToLatest} title="Jump to latest"
              className="absolute bottom-28 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-extrabold text-slate-500 shadow-lg ring-1 ring-slate-200 transition-colors hover:text-indigo-600">
              {hasNew ? <span className={`h-2 w-2 rounded-full ${t.dot} animate-pulse`} /> : <ArrowDown className="h-4 w-4" />}
              {hasNew ? "New reply" : "Latest"}
            </button>
          )}

          {showStarters && (
            <div className="grid grid-cols-1 gap-2 px-4 pb-3 sm:grid-cols-2 sm:px-5">
              {STARTERS(ctx.topic_name).map((s) => (
                <button key={s.label} onClick={() => send(s.label)}
                  className="group flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white/80 px-3.5 py-2.5 text-left text-xs font-extrabold text-slate-600 transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-md">
                  <span className="text-base">{s.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <Send className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-indigo-400" />
                </button>
              ))}
            </div>
          )}

          {showFollowups && (
            <div className="flex flex-wrap gap-2 px-4 pb-3 sm:px-5">
              {FOLLOWUPS.map((s) => (
                <button key={s.label} onClick={() => send(s.label)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-extrabold text-slate-600 transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm">
                  <span>{s.icon}</span> {s.label}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 p-3">
            {/* Tutor mode selector — changes how the tutor teaches. */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Mode</span>
              {MODES.map((m) => (
                <button key={m.id} onClick={() => setMode(m.id)} title={m.hint}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold transition-all ${
                    mode === m.id
                      ? `bg-gradient-to-br ${t.grad} text-white shadow-sm`
                      : "border border-slate-200 bg-white/80 text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
                  }`}>
                  <span>{m.icon}</span> {m.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-3xl bg-white p-2 shadow-sm ring-1 ring-slate-200 transition-shadow focus-within:ring-2 focus-within:ring-indigo-300">
              {/* Snap-a-doubt: photo -> OCR -> tutor solves it teaching-style */}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onSnapFile} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={streaming || snapBusy}
                title="Snap a doubt (photo of a problem)"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-slate-400 transition-colors hover:bg-slate-50 hover:text-indigo-600 disabled:opacity-40"
              >
                {snapBusy
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
                  : <Camera className="h-5 w-5" />}
              </button>
              {voiceSupported && (
                <button
                  onClick={toggleVoice}
                  disabled={streaming}
                  title={listening ? "Stop listening" : "Speak your question"}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-colors disabled:opacity-40 ${
                    listening ? "bg-rose-50 text-rose-500 ring-1 ring-rose-200 animate-pulse" : "text-slate-400 hover:bg-slate-50 hover:text-indigo-600"
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
              <Sparkles className="h-3 w-3" /> Scoped to <b>{ctx.topic_name}</b>
              <span className="hidden sm:inline">· Shift+Enter for a new line ·</span>
              <button onClick={() => setShowShortcuts(true)} className="hidden font-extrabold text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-indigo-600 sm:inline">shortcuts</button>
            </p>
          </div>
        </main>

        {/* RIGHT panel: the tutor's live mind (spec \u00a76) \u2014 collapsible */}
        {mindOpen && (
          <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto pr-0.5 xl:flex">
            <p className="flex items-center gap-2 px-1 text-sm font-extrabold text-slate-500">
              <Brain className="h-4 w-4 text-indigo-500" /> Tutor’s mind
            </p>
            <TutorMind mind={mind} />
          </aside>
        )}
      </div>

      {/* Mobile "tutor's mind" bottom sheet */}
      {mindSheet && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMindSheet(false)} />
          <div className="drawer-in absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-gradient-to-b from-slate-50 to-indigo-50/60 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-extrabold text-slate-700">
                <Brain className="h-4 w-4 text-indigo-500" /> Tutor’s mind
              </p>
              <button onClick={() => setMindSheet(false)} className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <TutorMind mind={mind} />
          </div>
        </div>
      )}

      {/* Mobile history drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="drawer-in absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col gap-3 bg-gradient-to-b from-slate-50 to-indigo-50/60 p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-sm font-extrabold text-slate-700">Chat history</p>
              <button onClick={() => setDrawerOpen(false)} className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <button onClick={newChat} className={`inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${t.grad} px-3 py-2.5 text-sm font-extrabold text-white shadow-md`}>
              <Plus className="h-4 w-4" /> New chat
            </button>
            <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-white/60 bg-white/70 p-3 backdrop-blur-sm">
              <SessionList sessions={sessions} sessionId={sessionId} onPick={switchSession} t={t} />
            </div>
          </div>
        </div>
      )}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

      {assessing && (
        <AssessmentFlow
          topicName={ctx.topic_name}
          topicId={ctx.topic_id}
          sessionId={sessionId}
          onClose={() => { setAssessing(false); loadMind(sessionId); onProgressChange?.(); }}
        />
      )}
    </div>
  );
}
