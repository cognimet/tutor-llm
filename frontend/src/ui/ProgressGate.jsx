import React, { useState, useMemo } from "react";
import { CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { confettiBurst } from "./confetti.js";

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

// Per-chat "this gate was already cleared" memory, so a checkpoint stays cleared
// when the student leaves the chat and comes back (instead of resetting).
function readCleared(key) {
  if (!key) return false;
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
function writeCleared(key) {
  if (!key) return;
  try { localStorage.setItem(key, "1"); } catch { /* storage unavailable */ }
}

/**
 * On-the-go interactive checkpoint (Visual Learning spec §3). The tutor emits a
 * [QUIZ: id correct=N ans="…"]…[OPTIONS]…[EXPLANATION]…[/QUIZ] block, parsed by
 * RichMessage and rendered here. The student must pick the correct option to
 * "clear" the gate — a wrong pick shakes with a Socratic hint (and keeps the
 * gate open), a correct pick fires confetti and unlocks the next part of the
 * lesson via onCorrectUnlock. When `persistKey` is given, a cleared gate is
 * remembered so revisiting the chat keeps it cleared.
 */
export default function ProgressGate({ question, options = [], correctAnswer = 0, correctText = "", explanation = "", onCorrectUnlock, persistKey }) {
  const correctIdx = useMemo(
    () => resolveCorrectIndex(options, correctAnswer, correctText),
    [options, correctAnswer, correctText],
  );

  // Hydrate from the remembered state so a previously-cleared gate renders as
  // cleared (correct option chosen) without replaying confetti or re-unlocking.
  const initCleared = () => readCleared(persistKey);
  const [cleared, setCleared] = useState(initCleared);
  const [restored] = useState(initCleared);            // cleared from memory, not a live answer
  const [selectedIdx, setSelectedIdx] = useState(() => (initCleared() ? correctIdx : null));
  const [attempts, setAttempts] = useState(0);         // re-keys the hint box to replay the shake
  const [unlocked, setUnlocked] = useState(initCleared); // guard: fire onCorrectUnlock once (never on restore)

  const handleSelect = (idx) => {
    if (cleared) return;                 // locked after a correct answer
    setSelectedIdx(idx);

    if (idx === correctIdx) {
      setCleared(true);
      writeCleared(persistKey);          // remember it so coming back keeps it cleared
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
