import React from "react";
import { MessageCircle, BrainCircuit, ArrowRight, Check, Star, BookOpen } from "lucide-react";
import { Backdrop, TopNav, Button, Badge } from "../ui/components.jsx";

// MVP scope: only the two features below — AI Tutor + topic-wise AI chat.
const FEATURES = [
  {
    icon: BrainCircuit,
    title: "AI Tutor",
    desc: "Learns your board, class and pace — then explains any concept step by step with examples, not just answers.",
    points: ["Step-by-step explanations", "Examples & common mistakes", "Adapts to your level"],
    grad: "from-indigo-500 to-violet-500",
    soft: "bg-indigo-50",
    text: "text-indigo-600",
  },
  {
    icon: MessageCircle,
    title: "Topic-wise AI Chat",
    desc: "Every chat is locked to one topic, so the tutor stays focused and your doubts never drift off-syllabus.",
    points: ["Scoped to a single topic", "On-syllabus, always", "Pick up where you left off"],
    grad: "from-rose-500 to-pink-500",
    soft: "bg-rose-50",
    text: "text-rose-600",
  },
];

export default function LandingScreen({ onStart }) {
  return (
    <div className="min-h-screen">
      <Backdrop />
      <TopNav
        onHome={onStart}
        right={
          <>
            <a className="hidden text-sm font-semibold text-slate-600 hover:text-indigo-600 sm:block" href="#features">Features</a>
            <Button variant="primary" className="px-4 py-2 text-sm" onClick={onStart}>
              Start learning <ArrowRight className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-10 text-center sm:pt-24">
        <div className="mx-auto flex justify-center">
          <Badge>Built for the Indian syllabus · CBSE · ICSE · State</Badge>
        </div>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-6xl">
          Your personal AI tutor that{" "}
          <span className="relative whitespace-nowrap">
            <span className="bg-gradient-to-br from-indigo-500 to-violet-500 bg-clip-text text-transparent">actually gets you</span>
            <svg className="absolute -bottom-2 left-0 w-full" height="12" viewBox="0 0 200 12" fill="none">
              <path d="M2 9C50 3 150 3 198 9" stroke="#a78bfa" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </span>
        </h1>
        <p className="mx-auto mt-7 max-w-xl text-lg text-slate-500">
          Ask any doubt in plain language. Get clear, step-by-step explanations — topic by topic, exactly to your class and board.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button onClick={onStart} className="text-base">
            Start learning free <ArrowRight className="h-5 w-5" />
          </Button>
          <Button variant="ghost" className="text-base">
            <BookOpen className="h-5 w-5" /> See how it works
          </Button>
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-400">
          <div className="flex">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />)}</div>
          Loved by students across India
        </div>
      </section>

      {/* Feature cards — the only two MVP features */}
      <section id="features" className="mx-auto max-w-6xl px-5 pb-24">
        <div className="grid gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="group relative overflow-hidden rounded-3xl border border-white/60 bg-white/70 p-7 shadow-xl shadow-slate-200/50 backdrop-blur-sm transition-all hover:-translate-y-1 hover:shadow-2xl">
              <div className={`absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${f.grad} opacity-10 blur-2xl`} />
              <div className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${f.grad} text-white shadow-lg`}>
                <f.icon className="h-7 w-7" />
              </div>
              <h3 className="mt-5 text-2xl font-extrabold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-slate-500">{f.desc}</p>
              <ul className="mt-5 space-y-2">
                {f.points.map((p) => (
                  <li key={p} className="flex items-center gap-2.5 text-sm font-semibold text-slate-700">
                    <span className={`grid h-5 w-5 place-items-center rounded-full ${f.soft} ${f.text}`}>
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Trust strip */}
        <div className="mt-8 grid grid-cols-3 gap-4 rounded-3xl border border-white/60 bg-white/60 p-6 text-center backdrop-blur-sm">
          {[
            ["6–12", "Classes covered"],
            ["6+", "Core subjects"],
            ["100%", "On-syllabus"],
          ].map(([n, l]) => (
            <div key={l}>
              <p className="text-3xl font-extrabold text-indigo-600">{n}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{l}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
