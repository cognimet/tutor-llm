import React, { useState } from "react";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { Backdrop, TopNav, Button, ProgressDots } from "../ui/components.jsx";
import { tint } from "../ui/tints.js";
import { BOARDS, CLASSES, LANGUAGES } from "../data/curriculum.js";

const STEPS = ["Board", "Class", "Language"];

export default function OnboardingScreen({ onHome, onDone }) {
  const [step, setStep] = useState(0);
  const [board, setBoard] = useState(null);
  const [klass, setKlass] = useState(null);
  const [lang, setLang] = useState("en");

  const canNext = (step === 0 && board) || (step === 1 && klass) || step === 2;

  const next = () => {
    if (step < 2) setStep(step + 1);
    else onDone({ board, klass, lang });
  };

  return (
    <div className="min-h-screen">
      <Backdrop />
      <TopNav onHome={onHome} right={<ProgressDots total={3} current={step} />} />

      <div className="mx-auto max-w-3xl px-5 py-12">
        <p className="text-sm font-bold uppercase tracking-widest text-indigo-400">
          Step {step + 1} of 3
        </p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          {step === 0 && "Which board are you studying?"}
          {step === 1 && "Pick your class"}
          {step === 2 && "Preferred language"}
        </h2>
        <p className="mt-2 text-slate-500">
          {step === 0 && "We tailor every explanation to your board's syllabus."}
          {step === 1 && "So topics and difficulty match your grade."}
          {step === 2 && "Your tutor can explain in any of these — switch anytime."}
        </p>

        {/* Step 0 — Board */}
        {step === 0 && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {BOARDS.map((b) => {
              const t = tint(b.tint);
              const active = board === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setBoard(b.id)}
                  className={`group relative flex items-center gap-4 rounded-3xl border bg-white/80 p-5 text-left backdrop-blur-sm transition-all hover:-translate-y-0.5 ${active ? `${t.border} ring-2 ${t.ring} shadow-lg` : "border-slate-100 shadow-sm"}`}
                >
                  <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-2xl ${t.soft}`}>{b.emoji}</div>
                  <div className="min-w-0">
                    <p className="text-lg font-extrabold text-slate-900">{b.name}</p>
                    <p className="truncate text-sm text-slate-400">{b.full}</p>
                  </div>
                  {active && (
                    <div className={`ml-auto grid h-7 w-7 place-items-center rounded-full ${t.solid} text-white`}>
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Step 1 — Class */}
        {step === 1 && (
          <div className="mt-8 grid grid-cols-3 gap-4 sm:grid-cols-4">
            {CLASSES.map((c) => {
              const active = klass === c;
              return (
                <button
                  key={c}
                  onClick={() => setKlass(c)}
                  className={`aspect-square rounded-3xl border bg-white/80 backdrop-blur-sm transition-all hover:-translate-y-0.5 ${active ? "border-indigo-300 bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30" : "border-slate-100 text-slate-800 shadow-sm"}`}
                >
                  <p className={`text-xs font-bold uppercase tracking-wide ${active ? "text-white/70" : "text-slate-400"}`}>Class</p>
                  <p className="text-3xl font-extrabold">{c}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 2 — Language */}
        {step === 2 && (
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {LANGUAGES.map((l) => {
              const active = lang === l.id;
              return (
                <button
                  key={l.id}
                  onClick={() => setLang(l.id)}
                  className={`rounded-3xl border bg-white/80 p-6 text-center backdrop-blur-sm transition-all hover:-translate-y-0.5 ${active ? "border-indigo-300 ring-2 ring-indigo-200 shadow-lg" : "border-slate-100 shadow-sm"}`}
                >
                  <p className="text-2xl font-extrabold text-slate-900">{l.native}</p>
                  <p className="mt-1 text-sm text-slate-400">{l.name}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* Nav */}
        <div className="mt-10 flex items-center justify-between">
          <Button variant="ghost" onClick={() => (step === 0 ? onHome() : setStep(step - 1))}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button onClick={next} disabled={!canNext}>
            {step === 2 ? "Start learning" : "Continue"} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
