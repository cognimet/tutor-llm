import React, { useEffect, useRef, useState } from "react";
import { X, Check, ArrowRight, Sparkles, Target, ListChecks, Loader2 } from "lucide-react";
import { assessmentApi, planApi } from "../../api/endpoints.js";

// Stages: loading -> quiz -> result -> plan
export default function AssessmentFlow({ topicName, topicId, sessionId, onClose }) {
  const [stage, setStage] = useState("loading");
  const [assessment, setAssessment] = useState(null);
  const [answers, setAnswers] = useState({}); // questionId -> selectedIndex
  const [result, setResult] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Guards: generate exactly once (React 18 StrictMode runs mount effects
  // twice in dev, which otherwise creates two assessments), and never let a
  // second submit fire while one is in flight.
  const generatedRef = useRef(false);
  const submittingRef = useRef(false);

  const loadQuiz = async () => {
    setStage("loading");
    setError("");
    try {
      const a = await assessmentApi.generate({ topic_name: topicName, topic_id: topicId, chat_session_id: sessionId, count: 3 });
      if (!a || !Array.isArray(a.questions) || a.questions.length === 0) {
        throw new Error("The AI returned an empty quiz. Please try again.");
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

  useEffect(() => {
    if (generatedRef.current) return;
    generatedRef.current = true;
    loadQuiz();
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

  const buildPlan = async () => {
    setBusy(true);
    try { setPlan(await planApi.generate(topicName)); setStage("plan"); }
    catch (err) { setError(err?.response?.data?.message || "Couldn't build a plan."); } finally { setBusy(false); }
  };

  const toggle = async (item) => {
    const updated = await planApi.toggleItem(item.id);
    setPlan((p) => ({ ...p, items: p.items.map((i) => (i.id === item.id ? updated : i)) }));
  };

  const allAnswered = assessment && assessment.questions.every((q) => answers[q.id] != null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white dark:bg-slate-800 shadow-2xl sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Target className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-extrabold text-slate-900 dark:text-white">Mini-assessment</p>
              <p className="text-xs text-slate-400">{topicName}</p>
            </div>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 dark:bg-white/10"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {stage === "loading" && <Centered><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /> Generating your quiz…</Centered>}
          {stage === "error" && (
            <Centered>
              <span>{error}</span>
              <button onClick={retryQuiz}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-md transition-transform active:scale-95">
                <Sparkles className="h-4 w-4" /> Try again
              </button>
            </Centered>
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
                <p className="flex items-center gap-2 font-extrabold text-slate-800 dark:text-slate-100"><Sparkles className="h-4 w-4 text-indigo-500" /> What the AI noticed</p>
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

          {stage === "plan" && plan && (
            <div className="space-y-4">
              <div className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-indigo-500" /><p className="font-extrabold text-slate-900 dark:text-white">{plan.title}</p></div>
              {plan.items.map((item) => (
                <button key={item.id} onClick={() => toggle(item)}
                  className="flex w-full items-start gap-3 rounded-2xl border border-slate-100 dark:border-white/10 bg-white dark:bg-slate-800 p-4 text-left transition-all hover:border-indigo-200">
                  <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${item.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"}`}>
                    {item.status === "done" && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  <div className="flex-1">
                    <p className={`text-sm font-extrabold ${item.status === "done" ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"}`}>{item.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{item.detail}</p>
                    <p className="mt-1 text-[11px] font-bold text-indigo-400">~{item.estimated_minutes} min · {item.concept}</p>
                  </div>
                </button>
              ))}
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
            <button onClick={buildPlan} disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 px-5 py-3 font-extrabold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-40">
              {busy ? "Building…" : "Get my next steps"} <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {stage === "plan" && (
            <button onClick={onClose} className="w-full rounded-2xl bg-slate-900 px-5 py-3 font-extrabold text-white">Done — back to tutor</button>
          )}
        </div>
      </div>
    </div>
  );
}

const Centered = ({ children }) => <div className="flex items-center justify-center gap-3 py-16 font-bold text-slate-500 dark:text-slate-400">{children}</div>;
const sevCls = (s) => ({ high: "bg-rose-100 text-rose-600", medium: "bg-amber-100 text-amber-600", low: "bg-emerald-100 text-emerald-600" }[s] || "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400");
