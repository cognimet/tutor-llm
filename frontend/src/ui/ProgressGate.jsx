import React, { useState, useMemo, useEffect } from "react";
import { CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { confettiBurst } from "./confetti.js";
import { tutorApi } from "../api/endpoints.js";
import MathText from "./mathText.jsx";

// Value-grounded grading: the answer STRING wins over the numeric index, so a
// wrong/off-by-one `correct` from the model can't mark a wrong option right.
function resolveCorrectIndex(options, correctAnswer, correctText) {
  const want = String(correctText || "").trim().toLowerCase();
  if (want) {
    const i = options.findIndex((o) => String(o).trim().toLowerCase() === want);
    if (i >= 0) return i;
  }
  return correctAnswer;
}

/**
 * On-the-go interactive checkpoint (Visual Learning spec §3). The tutor emits a
 * [QUIZ: id correct=N ans="…"]…[OPTIONS]…[EXPLANATION]…[/QUIZ] block, parsed by
 * RichMessage and rendered here. A correct pick clears the gate (confetti +
 * unlock the next part); a wrong pick shakes with a Socratic hint.
 *
 * Progress is DURABLE: every attempt is logged to the session (quiz_attempt with
 * the selected index, option text, question and first-try/retry sequence), and
 * on load the gate re-hydrates from those logs — so a cleared checkpoint stays
 * cleared across refresh / leaving the chat, on any device.
 */
export default function ProgressGate({
  question,
  options = [],
  correctAnswer = 0,
  correctText = "",
  explanation = "",
  targetId,
  sessionId,
  historicalLogs = [],
  onCorrectUnlock,
  onLogUpdate,
}) {
  const correctIdx = useMemo(
    () => resolveCorrectIndex(options, correctAnswer, correctText),
    [options, correctAnswer, correctText],
  );

  // Remembered state derived from this gate's DB logs.
  const dbCleared = useMemo(() => historicalLogs.some((l) => l.is_correct), [historicalLogs]);
  const dbAttempts = historicalLogs.length;
  const dbSelectedIdx = useMemo(() => {
    const correctLog = historicalLogs.find((l) => l.is_correct);
    if (correctLog) return correctLog.metadata?.selected_idx ?? correctIdx;
    const last = historicalLogs[historicalLogs.length - 1];
    return last ? (last.metadata?.selected_idx ?? null) : null;
  }, [historicalLogs, correctIdx]);

  const [cleared, setCleared] = useState(dbCleared);
  const [restored, setRestored] = useState(dbCleared);   // cleared from history, not a live answer
  const [selectedIdx, setSelectedIdx] = useState(dbSelectedIdx);
  const [attempts, setAttempts] = useState(dbAttempts);
  const [unlocked, setUnlocked] = useState(dbCleared);    // guard: fire onCorrectUnlock once (never on restore)

  // Logs often arrive after first paint (session fetch). Hydrate then — but never
  // override a live answer the student just gave this mount.
  useEffect(() => {
    if (cleared) return;
    if (dbCleared || historicalLogs.length) {
      setCleared(dbCleared);
      setRestored(dbCleared);
      setSelectedIdx(dbSelectedIdx);
      setAttempts(dbAttempts);
      setUnlocked(dbCleared);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbCleared, dbSelectedIdx, dbAttempts, historicalLogs.length]);

  const handleSelect = (idx) => {
    if (cleared) return;                 // locked after a correct answer
    setSelectedIdx(idx);

    const isCorrect = idx === correctIdx;
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);

    if (isCorrect) {
      setCleared(true);
      setRestored(false);
      confettiBurst({ particleCount: 90, spread: 70, originY: 0.7 });
    }

    // Persist the attempt (server assigns the authoritative attempt_number).
    if (sessionId && targetId) {
      const log = {
        type: "quiz_attempt",
        target_id: targetId,
        is_correct: isCorrect,
        metadata: { selected_idx: idx, option_text: options[idx], question_text: question },
      };
      tutorApi.logProgress(sessionId, log).catch(() => { /* non-blocking */ });
      onLogUpdate?.({ ...log, attempt_number: nextAttempts });
    }

    if (isCorrect && !unlocked) {
      setUnlocked(true);
      setTimeout(() => onCorrectUnlock?.(), 1800);
    }
  };

  const wasWrong = selectedIdx !== null && selectedIdx !== correctIdx && !cleared;

  return (
    <div
      className={`msg-in my-4 rounded-2xl border-2 p-5 transition-all duration-300 ${
        cleared
          ? "border-emerald-500 bg-emerald-50/30 shadow-lg shadow-emerald-500/10 dark:bg-emerald-500/5"
          : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900"
      }`}
    >
      {/* Status badge */}
      <div className="mb-3 flex items-center gap-1.5">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
            cleared ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
          }`}
        >
          {cleared ? "✨ Checkpoint cleared" : "🧠 Progress gate"}
        </span>
      </div>

      <MathText
        as="p"
        text={question}
        className="mb-4 text-sm font-extrabold leading-relaxed text-slate-800 dark:text-slate-100"
      />

      <div className="grid gap-2.5">
        {options.map((opt, idx) => {
          const isSelected = selectedIdx === idx;
          const isCorrect = idx === correctIdx;

          let optStyle = "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5";
          let badge = null;
          if (isSelected && isCorrect) {
            optStyle = "border-emerald-500 bg-emerald-500/10 font-extrabold text-emerald-800 ring-2 ring-emerald-400 dark:text-emerald-300";
            badge = <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
          } else if (isSelected && !isCorrect) {
            optStyle = "border-rose-400 bg-rose-500/5 font-extrabold text-rose-800 ring-2 ring-rose-300 dark:text-rose-400";
            badge = <XCircle className="h-4 w-4 shrink-0 text-rose-500" />;
          } else if (cleared && isCorrect) {
            optStyle = "border-emerald-500 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300";
          }

          return (
            <button
              key={idx}
              disabled={cleared && idx !== selectedIdx}
              onClick={() => handleSelect(idx)}
              className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 text-left text-xs font-bold transition-all active:scale-[0.99] disabled:cursor-default ${optStyle}`}
            >
              <MathText text={opt} />
              {badge}
            </button>
          );
        })}
      </div>

      {/* Socratic feedback */}
      {selectedIdx !== null && (
        <div
          key={cleared ? "ok" : `wrong-${attempts}`}
          className={`mt-4 rounded-xl p-3.5 text-xs transition-all ${
            cleared
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "animate-shake bg-rose-50 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300"
          }`}
        >
          <p className="mb-1 font-extrabold">
            {cleared ? "Amazing job! 🎉" : "Not quite — let's think it through 💡"}
          </p>
          {explanation && <p className="font-medium leading-relaxed">{explanation}</p>}
          {wasWrong && <p className="mt-1 font-bold opacity-80">Tap another answer to try again.</p>}
          {cleared && !restored && (
            <div className="mt-3 flex justify-end border-t border-emerald-200/50 pt-2">
              <span className="flex items-center gap-1 text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400">
                Unlocking next card… <ChevronRight className="h-3 w-3 animate-bounce" />
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
