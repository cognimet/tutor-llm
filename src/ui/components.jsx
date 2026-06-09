import React from "react";
import { Sparkles, GraduationCap } from "lucide-react";

// Soft floating gradient blobs used as a playful page backdrop.
export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-indigo-300/40 blur-3xl" />
      <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-rose-300/40 blur-3xl" />
      <div className="absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-amber-200/50 blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(99,102,241,0.08)_1px,transparent_0)] [background-size:22px_22px]" />
    </div>
  );
}

// Brand mark — friendly owl mascot in a rounded gradient tile.
export function Logo({ size = "md" }) {
  const dims = size === "lg" ? "h-12 w-12 text-2xl" : "h-9 w-9 text-lg";
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div className={`grid place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30 ${dims}`}>
        <span>🦉</span>
      </div>
      <div className="leading-tight">
        <p className="font-extrabold tracking-tight text-slate-800">Tuto<span className="text-indigo-500">.ai</span></p>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">AI Tutor</p>
      </div>
    </div>
  );
}

export function Button({ children, variant = "primary", className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-all active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100";
  const styles = {
    primary: "bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 px-5 py-3",
    ghost: "bg-white/70 text-slate-700 ring-1 ring-slate-200 hover:bg-white px-5 py-3",
    soft: "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-5 py-3",
    pill: "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-indigo-300 hover:text-indigo-600 px-4 py-2 text-sm",
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Badge({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-indigo-600 ring-1 ring-indigo-100 ${className}`}>
      <Sparkles className="h-3.5 w-3.5" /> {children}
    </span>
  );
}

// Stepper dots for onboarding.
export function ProgressDots({ total, current }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all ${i === current ? "w-8 bg-indigo-500" : i < current ? "w-2 bg-indigo-300" : "w-2 bg-slate-200"}`}
        />
      ))}
    </div>
  );
}

export function TopNav({ onHome, right }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/40 bg-white/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <button onClick={onHome} className="transition-transform hover:scale-[1.02]">
          <Logo />
        </button>
        <div className="flex items-center gap-3">{right}</div>
      </div>
    </header>
  );
}
