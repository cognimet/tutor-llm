import React, { useEffect, useRef, useState } from "react";
import { X, ArrowRight, Sparkles, Target, Loader2, BookOpen } from "lucide-react";
import { assessmentApi } from "../../api/endpoints.js";

// Stages: loading -> quiz -> result. After the result, the student is pointed
// to the Study hub's "What to work on" (real, actionable next steps) instead of
// a throwaway in-modal checklist.
// scope "exam" + a higher count = a bigger, multi-concept assessment.
export default function AssessmentFlow({ topicName, topicId, sessionId, onClose, onSeeWork, scope = "topic", count }) {
  const isBig = scope === "exam";
  const [stage, setStage] = useState("loading");
  const [assessment, setAssessment] = useState(null);
  const [answers, setAnswers] = useState({}); // questionId -> selectedIndex
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gate, setGate] = useState(null); // soft learning-gate readiness payload
  // Guards: generate exactly once (React 18 StrictMode runs mount effects
  // twice in dev, which otherwise creates two assessments), and never let a
  // second submit fire while one is in flight.
  const generatedRef = useRef(false);
  const submittingRef = useRef(false);

  const loadQuiz = async () => {
    setStage("loading");
    setError("");
    try {
      const a = await assessmentApi.generate({
        topic_name: topicName, topic_id: topicId, chat_session_id: sessionId,
        scope, ...(count ? { count } : {}),
      });
      if (!a || !Array.isArray(a.questions) || a.questions.length === 0) {
        throw new Error("We couldn't build your quiz just now. Please try again.");
      }
      setAssessment(a); setStage("quiz");
    } catch (err) {
      // Surface the backend's reason (e.g. rate-limited AI, out of credits).
      setError(err?.response?.data?.message || err?.message || "Couldn't generate a quiz. Please try again.");
      setStage("error");
    }
  };

  const retryQuiz = () => {
    generatedRef.current = true; // an explicit retry counts as the one run
    loadQuiz();
  };

  // Soft learning-gate: for a quick topic check, nudge the student to learn
  // first if they haven't studied this topic / mastery is low. Never blocks —
  // they can take it anyway. Plan-driven big assessments (scope=exam) skip it.
  const start = async () => {
    if (isBig) { loadQuiz(); return; }
    try {
      const r = await assessmentApi.readiness({ topic_name: topicName, topic_id: topicId });
      if (r?.recommend_learn) { setGate(r); setStage("gate"); return; }
    } catch { /* readiness is optional — fall through to the quiz */ }
    loadQuiz();
  };

  useEffect(() => {
    if (generatedRef.current) return;
    generatedRef.current = true;
    start();
  }, []);

  const submit = async () => {
    if (submittingRef.current || busy || stage !== "quiz") return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = assessment.questions.map((q) => ({ question_id: q.id, selected_index: answers[q.id] ?? -1 }));
      const res = await assessmentApi.submit(assessment.id, payload);
      setResult(res); setStage("result");
    } catch (err) {
      setError(err?.response?.data?.message || "Submission failed. Please try again.");
      submittingRef.current = false; // allow another attempt only on failure
    } finally { setBusy(false); }
  };

  const seeWork = () => { if (onSeeWork) onSeeWork(); else onClose(); };

  const allAnswered = assessment && assessment.questions.every((q) => answers[q.id] != null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white dark:bg-slate-800 shadow-2xl sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Target className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-extrabold text-slate-900 dark:text-white">{isBig ? "Big assessment" : "Mini-assessment"}</p>
              <p className="text-xs text-slate-400">{topicName}</p>
            </div>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 dark:bg-white/10"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {stage === "loading" && <Centered><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /> {isBig ? "Building your big assessment…" : "Generating your quiz…"}</Centered>}
          {stage === "error" && (
            <Centered>
              <span>{error}</span>
              <button onClick={retryQuiz}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-md transition-transform active:scale-95">
                <Sparkles className="h-4 w-4" /> Try again
              </button>
            </Centered>
          )}

          {stage === "gate" && gate && (
            <div className="flex flex-col items-center py-10 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-500 dark:bg-amber-500/15 dark:text-amber-300">
                <BookOpen className="h-7 w-7" />
              </span>
              <p className="mt-4 text-base font-extrabold text-slate-900 dark:text-white">Learn this first?</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{gate.reason}</p>
              {typeof gate.mastery === "number" && gate.mastery > 0 && (
                <p className="mt-2 text-[11px] font-bold text-slate-400">Current mastery: {gate.mastery}%</p>
              )}
              <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
                <button onClick={onClose}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 px-5 py-3 text-sm font-extrabold text-white shadow-md transition-transform active:scale-95">
                  <BookOpen className="h-4 w-4" /> Learn first
                </button>
                <button onClick={loadQuiz}
                  className="w-full rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-extrabold text-slate-500 transition-colors hover:text-slate-800 dark:border-white/10 dark:text-slate-300">
                  Take the check anyway
                </button>
              </div>
            </div>
          )}

          {stage === "quiz" && assessment && (
            <div className="space-y-6">
              {error && (
                <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{error}</p>
              )}
              {assessment.questions.map((q, qi) => (
                <div key={q.id}>
                  <p className="font-extrabold text-slate-800 dark:text-slate-100">{qi + 1}. {q.question}</p>
                  <div className="mt-3 grid gap-2">
                    {q.options.map((opt, oi) => {
                      const sel = answers[q.id] === oi;
                      return (
                        <button key={oi} disabled={busy}
                          onClick={() => { if (busy) return; setAnswers((a) => ({ ...a, [q.id]: oi })); }}
                          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${sel ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300"}`}>
                          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${sel ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400"}`}>{"ABCD"[oi]}</span>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {stage === "result" && result && (
            <div className="space-y-5">
              <div className="rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-500 p-6 text-center text-white">
                <p className="text-sm font-bold uppercase tracking-wide text-white/70">Your score</p>
                <p className="font-display text-5xl font-extrabold">{result.score}/{result.total}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 dark:bg-white/5 p-4 text-sm text-slate-600 dark:text-slate-300">
                <p className="flex items-center gap-2 font-extrabold text-slate-800 dark:text-slate-100"><Sparkles className="h-4 w-4 text-indigo-500" /> What we noticed</p>
                <p className="mt-1">{result.summary}</p>
              </div>
              {result.gaps?.length > 0 && (
                <div>
                  <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Knowledge gaps</p>
                  <div className="mt-2 space-y-2">
                    {result.gaps.map((g) => (
                      <div key={g.id} className="flex items-start gap-3 rounded-2xl border border-slate-100 dark:border-white/10 bg-white dark:bg-slate-800 p-3">
                        <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${sevCls(g.severity)}`}>{g.severity}</span>
                        <div><p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{g.concept}</p><p className="text-xs text-slate-500 dark:text-slate-400">{g.recommendation}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-100 dark:border-white/10 p-4">
          {stage === "quiz" && (
            <button onClick={submit} disabled={!allAnswered || busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 px-5 py-3 font-extrabold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-40">
              {busy ? "Checking…" : "Submit answers"} <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {stage === "result" && (
            <div className="flex gap-2">
              <button onClick={onClose}
                className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-extrabold text-slate-500 transition-colors hover:text-slate-800 dark:border-white/10 dark:text-slate-300">
                Back to tutor
              </button>
              <button onClick={seeWork}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 px-5 py-3 font-extrabold text-white shadow-lg shadow-indigo-500/30">
                See what to work on <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Centered = ({ children }) => <div className="flex items-center justify-center gap-3 py-16 font-bold text-slate-500 dark:text-slate-400">{children}</div>;
const sevCls = (s) => ({ high: "bg-rose-100 text-rose-600", medium: "bg-amber-100 text-amber-600", low: "bg-emerald-100 text-emerald-600" }[s] || "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400");
