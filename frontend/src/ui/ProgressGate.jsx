import React, { useState, useMemo } from "react";
import { CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { confettiBurst } from "./confetti.js";

/**
 * On-the-go interactive checkpoint (Visual Learning spec §3). The tutor emits a
 * [QUIZ: id correct=N]…[OPTIONS]…[EXPLANATION]…[/QUIZ] block, parsed by
 * RichMessage and rendered here. The student must pick the correct option to
 * "clear" the gate — a wrong pick shakes with a Socratic hint (and keeps the
 * gate open), a correct pick fires confetti and unlocks the next part of the
 * lesson via onCorrectUnlock.
 */
export default function ProgressGate({ question, options = [], correctAnswer = 0, correctText = "", explanation = "", onCorrectUnlock }) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [cleared, setCleared] = useState(false);   // true once answered correctly
  const [attempts, setAttempts] = useState(0);      // re-keys the hint box to replay the shake
  const [unlocked, setUnlocked] = useState(false);  // guard: fire onCorrectUnlock once

  // Value-grounded grading: the answer STRING is the source of truth. Models
  // sometimes emit a wrong/off-by-one `correct` index, which would mark a wrong
  // option right. When ans="…" is present and matches an option, THAT option is
  // authoritative; the numeric index is only a fallback when no string is given.
  const correctIdx = useMemo(() => {
    const want = correctText.trim().toLowerCase();
    if (want) {
      const i = options.findIndex((o) => String(o).trim().toLowerCase() === want);
      if (i >= 0) return i;
    }
    return correctAnswer;
  }, [correctText, options, correctAnswer]);

  const handleSelect = (idx) => {
    if (cleared) return;                 // locked after a correct answer
    setSelectedIdx(idx);

    if (idx === correctIdx) {
      setCleared(true);
      confettiBurst({ particleCount: 90, spread: 70, originY: 0.7 });
      if (!unlocked) {
        setUnlocked(true);
        setTimeout(() => onCorrectUnlock?.(), 1800);
      }
    } else {
      setAttempts((a) => a + 1);
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

      <p className="mb-4 text-sm font-extrabold leading-relaxed text-slate-800 dark:text-slate-100">
        {question}
      </p>

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
              <span>{opt}</span>
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
          {cleared && (
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
