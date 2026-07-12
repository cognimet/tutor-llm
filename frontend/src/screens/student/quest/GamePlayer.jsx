/**
 * Plays one generated game: renders each item with its mechanic, posts the
 * child's response for server-side grading, and rolls the result up on finish.
 *
 * Every answer is an evidence event — the durable fact from which BKT mastery
 * and IRT ability are derived. The client shows the outcome; it never decides it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Lightbulb, CheckCircle2, XCircle, Loader2, Swords } from "lucide-react";
import { questApi } from "../../../api/endpoints.js";
import Mechanic from "./mechanics.jsx";
import UpgradeCTA, { isQuotaError } from "../../../ui/UpgradeCTA.jsx";

// Adventure-prep framing, not "we're building a test" — the child is about to
// enter a world, so the loading beats read like getting a quest ready.
const GEN_STEPS = [
  "Scouting the lands… 🗺️",
  "Waking your guide… 🦉",
  "Hiding the stars… ⭐",
  "Almost ready… 🎈",
];

/* Varied praise keeps a child playing — the same "Correct!" gets stale fast. */
const PRAISE = ["Woohoo! 🎉", "You got it! ⭐", "Super smart! 🦄", "Nailed it! 🚀", "High five! ✋", "Brilliant! 💡"];
const NUDGE = ["Almost! You'll get the next one 💪", "Not quite — keep going! 🌈", "Good try! Every hero misses sometimes 🦸", "So close! On to the next 🐾"];

/** Emoji confetti raining inside the modal. Pure CSS, removes itself via animation fill. */
function Confetti({ count = 26 }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        dur: 1.8 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 180,
        size: 14 + Math.random() * 14,
        emoji: ["🎉", "⭐", "🎊", "✨", "🌟", "💛", "💙", "💜"][i % 8],
      })),
    [count],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-3xl">
      {pieces.map((p, i) => (
        <span key={i} className="confetti-piece"
          style={{ left: `${p.left}%`, fontSize: p.size, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, "--drift": `${p.drift}px` }}>
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

export default function GamePlayer({ topicId, topicName, difficulty, onClose, onFinished }) {
  const [stage, setStage] = useState("loading"); // loading | play | result | error
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState(null);
  const [quota, setQuota] = useState(false); // the error is an out-of-credits block
  const [game, setGame] = useState(null);

  const [index, setIndex] = useState(0);
  const [verdict, setVerdict] = useState(null); // {correct, can_retry, explain, correct_answer, ...}
  const [attempt, setAttempt] = useState(1); // a first miss earns one retry
  const [hinted, setHinted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);

  const startedAt = useRef(Date.now());
  const abortRef = useRef(null);

  /* ----------------------------- generation ----------------------------- */
  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStage("loading");
    setPhase(0);
    setQuota(false);
    try {
      const g = await questApi.generate({ topic_id: topicId, difficulty }, { signal: controller.signal });
      setGame(g);
      setIndex(0);
      setVerdict(null);
      setAttempt(1);
      setHinted(false);
      startedAt.current = Date.now();
      setStage("play");
      // Building a game spends a credit — tick the meter down immediately.
      window.dispatchEvent(new Event("usage:refresh"));
    } catch (err) {
      // Closing mid-generation aborts the request — that's not an error.
      if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
      const locked = err?.response?.status === 423;
      setQuota(isQuotaError(err));
      setError(
        err?.response?.data?.message ||
          (locked ? "Finish this topic's prerequisites first." : "We couldn't start this game."),
      );
      setStage("error");
    }
  }, [topicId, difficulty]);

  // Generate on mount / whenever the topic or difficulty changes, and abort the
  // in-flight request when the player unmounts.
  //
  // NOTE: this must NOT be guarded by a "already loaded" ref. React StrictMode
  // (dev) mounts, unmounts, then remounts — the unmount aborts the request, so a
  // one-shot guard would skip the remount's reload and leave the modal stuck on
  // "loading" forever. Re-running load() here is correct: load() aborts any prior
  // controller, so a genuine re-fetch never races an old one.
  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (stage !== "loading") return;
    const id = setInterval(() => setPhase((p) => Math.min(p + 1, GEN_STEPS.length - 1)), 2400);
    return () => clearInterval(id);
  }, [stage]);

  /* ------------------------------- playing ------------------------------ */
  const submit = async (value) => {
    if (checking || verdict) return;
    setChecking(true);
    try {
      const res = await questApi.answer(game.id, {
        item_index: index,
        answer: value,
        time_ms: Date.now() - startedAt.current,
        hints_used: hinted ? 1 : 0,
      });
      setVerdict(res);
    } catch {
      setVerdict({ correct: false, error: true });
    } finally {
      setChecking(false);
    }
  };

  // A first miss re-arms the same item: fresh mechanic state, hint auto-opened.
  // The server has already recorded the miss as evidence — this is the child's
  // chance to fix it and learn, not to erase it (finish() scores first attempts).
  const retry = () => {
    setVerdict(null);
    setAttempt(2);
    setHinted(true);
    startedAt.current = Date.now();
  };

  // Stop any narration when the question changes or the player closes.
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* absent */ } }, []);

  const advance = async () => {
    try { window.speechSynthesis?.cancel(); } catch { /* absent */ }
    const last = index >= game.items.length - 1;
    if (!last) {
      setIndex((i) => i + 1);
      setVerdict(null);
      setAttempt(1);
      setHinted(false);
      startedAt.current = Date.now();
      return;
    }
    try {
      const summary = await questApi.finish(game.id);
      setResult(summary);
      setStage("result");
      onFinished?.(summary);
      // Let the rest of the app refresh its progress bars.
      window.dispatchEvent(new Event("progress:refresh"));
    } catch {
      setError("We couldn't save your result. Your answers were recorded.");
      setStage("error");
    }
  };

  /* ------------------------------- chrome ------------------------------- */
  // Dialog semantics: labelled, Esc closes, focus lands inside on open so a
  // keyboard / screen-reader user is never stranded behind the overlay.
  const dialogRef = useRef(null);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shell = (children) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={`${topicName} game`}
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900">
        <button onClick={onClose} aria-label="Close game"
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );

  if (stage === "loading") {
    return shell(
      <div className="space-y-5 py-6">
        <div className="game-bounce text-center text-5xl">🎮</div>
        <h3 className="text-center font-display text-xl font-extrabold text-slate-800 dark:text-slate-100">
          Opening the {topicName} adventure
        </h3>
        <ul className="mx-auto max-w-xs space-y-3">
          {GEN_STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-3 text-sm">
              {i < phase ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : i === phase ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-200 dark:border-slate-700" />
              )}
              <span className={i <= phase ? "font-semibold text-slate-700 dark:text-slate-200" : "text-slate-400"}>
                {step}
              </span>
            </li>
          ))}
        </ul>
      </div>,
    );
  }

  if (stage === "error") {
    // Out of credits → the upgrade path, not a retry that would just re-block.
    if (quota) {
      return shell(<UpgradeCTA message={error} onNavigate={onClose} />);
    }
    return shell(
      <div className="space-y-4 py-6 text-center">
        <XCircle className="mx-auto h-10 w-10 text-rose-500" />
        <p className="font-semibold text-slate-700 dark:text-slate-200">{error}</p>
        <div className="flex justify-center gap-3">
          <button onClick={load} className="rounded-2xl border border-slate-200 px-5 py-2 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            Try again
          </button>
          <button onClick={onClose} className="rounded-2xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white">
            Close
          </button>
        </div>
      </div>,
    );
  }

  if (stage === "result") {
    const passed = result.percent >= 70;
    const stars = Math.max(1, Math.round((result.percent / 100) * 3)); // 1–3 stars, kids always get one
    return shell(
      <div className="space-y-5 py-4 text-center">
        {passed && <Confetti count={32} />}
        <div className="game-tada text-6xl">{passed ? "🏆" : "💪"}</div>

        <div className="flex justify-center gap-1 text-4xl">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < stars ? "game-pop" : "opacity-25 grayscale"}
              style={{ animationDelay: `${i * 180}ms` }}>
              ⭐
            </span>
          ))}
        </div>

        <h3 className="font-display text-3xl font-black text-slate-800 dark:text-slate-100">
          {result.score} of {result.total} stars collected!
        </h3>
        <p className="text-sm font-bold text-slate-500">
          {passed ? "Amazing! You cleared this adventure! 🎊" : "Great exploring! Dive back in to grab every star 🌟"}
        </p>

        {result.p_mastered != null && (
          <div className="mx-auto max-w-xs space-y-1.5">
            <div className="flex justify-between text-xs font-bold text-slate-500">
              <span>Topic power-up</span>
              <span>{Math.round(result.p_mastered * 100)}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400 transition-all"
                style={{ width: `${Math.round(result.p_mastered * 100)}%` }} />
            </div>
          </div>
        )}

        {result.reward?.points_gained > 0 && (
          <p className="game-pop font-display text-lg font-extrabold text-indigo-600 dark:text-indigo-400">
            +{result.reward.points_gained} {result.reward.engine_mode === "junior" ? "🌟 stars" : "⚡ XP"}
          </p>
        )}

        {result.next && (
          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 dark:bg-slate-800">
            Next adventure: <span className="text-slate-700 dark:text-slate-200">{result.next.topic_name}</span> — {result.next.reason}
          </p>
        )}

        <div className="flex justify-center gap-3">
          <button onClick={load}
            className="rounded-2xl border-2 border-b-4 border-slate-300 px-5 py-2.5 font-display text-sm font-extrabold text-slate-600 transition-all active:translate-y-0.5 active:border-b-2 dark:border-slate-600 dark:text-slate-300">
            Play again 🔁
          </button>
          <button onClick={onClose}
            className="rounded-2xl border-b-4 border-indigo-800 bg-gradient-to-b from-indigo-500 to-indigo-600 px-5 py-2.5 font-display text-sm font-extrabold text-white transition-all active:translate-y-0.5 active:border-b-2">
            Back to my map 🗺️
          </button>
        </div>
      </div>,
    );
  }

  /* --------------------------------- play -------------------------------- */
  const item = game.items[index];
  const earned = index + (verdict?.correct ? 1 : 0); // stars lit on the trail

  // Read the question aloud (Web Speech API) — the pre-reader / early-grade
  // path: a child who can't read the prompt yet can still play. Best-effort;
  // silently absent where the browser has no voices.
  const speak = () => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const text = [item.prompt, item.params?.sentence?.replaceAll("_____", "blank")]
        .filter(Boolean).join(". ");
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      synth.speak(u);
    } catch { /* narration is an extra, never an error */ }
  };
  // Stable per-question praise/nudge — no reroll on re-render.
  const cheer = verdict?.correct ? PRAISE[index % PRAISE.length] : NUDGE[index % NUDGE.length];

  return shell(
    <div className="space-y-5">
      {verdict?.correct && <Confetti />}

      <div className="pr-8">
        <div className="flex items-center gap-2 font-display text-xs font-extrabold uppercase tracking-wide text-indigo-500">
          <Swords className="h-3.5 w-3.5" /> Level {game.difficulty}
        </div>
        <h3 className="mt-1 font-display text-xl font-extrabold text-slate-800 dark:text-slate-100">{game.topic_name}</h3>
      </div>

      {/* A star trail beats a progress bar — each question is a star to win. */}
      <div className="flex items-center justify-center gap-1.5">
        {game.items.map((_, i) => (
          <span key={i}
            className={`text-2xl transition-all ${
              i < earned ? "game-pop" : i === index ? "game-blank-pulse opacity-60" : "opacity-25 grayscale"
            }`}>
            ⭐
          </span>
        ))}
      </div>
      <p className="text-center font-display text-xs font-extrabold text-slate-400">
        Star {index + 1} of {game.items.length} ⭐
      </p>

      <div className="flex items-center justify-center gap-2">
        <p className="text-center font-display text-lg font-bold text-slate-700 dark:text-slate-200">{item.prompt}</p>
        <button onClick={speak} aria-label="Read the question aloud"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-sm transition-all hover:scale-110 dark:bg-slate-800">
          🔊
        </button>
      </div>

      {/* Remount per item AND per attempt, so a retry starts from a clean board. */}
      <Mechanic key={`${index}-${attempt}`} params={item.params} disabled={!!verdict || checking} onSubmit={submit} />

      {!verdict && item.hint && (
        <button onClick={() => setHinted(true)}
          className="mx-auto flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-indigo-500">
          <Lightbulb className="h-3.5 w-3.5" /> {hinted ? item.hint : "Psst… need a hint? 🤫"}
        </button>
      )}

      {/* aria-live so screen readers announce each verdict as it lands. */}
      <div aria-live="assertive">
      {verdict && (
        <div className={`space-y-3 rounded-3xl border-2 p-4 text-center ${
          verdict.correct
            ? "game-tada border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
            : "animate-shake border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
        }`}>
          <p className={`flex items-center justify-center gap-2 font-display text-xl font-extrabold ${
            verdict.correct ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
          }`}>
            {verdict.correct ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
            {verdict.error ? "Couldn't check that — moving on." : verdict.can_retry ? "Not quite — take another look! 🔍" : cheer}
          </p>

          {/* First miss: one more go, with the hint handed over. No answer yet —
              revealing it would turn the retry into a copy exercise. */}
          {verdict.can_retry ? (
            <>
              {item.hint && (
                <p className="mx-auto max-w-sm rounded-2xl bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  💡 Hint: {item.hint}
                </p>
              )}
              <div className="flex justify-center gap-3">
                <button onClick={retry}
                  className="rounded-2xl border-b-4 border-indigo-800 bg-gradient-to-b from-indigo-500 to-indigo-600 px-8 py-2.5 font-display text-base font-extrabold text-white transition-all active:translate-y-0.5 active:border-b-2">
                  Try again 🔁
                </button>
                <button onClick={advance}
                  className="rounded-2xl border-2 border-b-4 border-slate-300 px-5 py-2.5 font-display text-sm font-extrabold text-slate-500 transition-all active:translate-y-0.5 active:border-b-2 dark:border-slate-600 dark:text-slate-400">
                  Skip ➜
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Item finished: reveal the answer (if missed) and teach the why. */}
              {!verdict.correct && verdict.correct_answer && (
                <p className="font-display text-sm font-extrabold text-slate-600 dark:text-slate-300">
                  The answer was: <span className="text-indigo-600 dark:text-indigo-400">{verdict.correct_answer}</span>
                </p>
              )}
              {verdict.explain && (
                <p className="game-drop mx-auto max-w-sm rounded-2xl bg-sky-50 px-4 py-2.5 text-sm font-bold text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">
                  🧠 {verdict.explain}
                </p>
              )}
              {verdict.mastered && (
                <p className="game-pop font-display text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                  🎉 You've mastered this topic!
                </p>
              )}
              <button onClick={advance}
                className="rounded-2xl border-b-4 border-indigo-800 bg-gradient-to-b from-indigo-500 to-indigo-600 px-8 py-2.5 font-display text-base font-extrabold text-white transition-all active:translate-y-0.5 active:border-b-2">
                {index >= game.items.length - 1 ? "See my prize! 🏆" : "Next one! ➜"}
              </button>
            </>
          )}
        </div>
      )}
      </div>
    </div>,
  );
}
