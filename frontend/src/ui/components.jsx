import React from "react";
import { Sparkles, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext.jsx";

export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-indigo-300/40 blur-3xl dark:bg-indigo-500/20" />
      <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-rose-300/40 blur-3xl dark:bg-fuchsia-500/15" />
      <div className="absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-amber-200/50 blur-3xl dark:bg-violet-500/15" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(99,102,241,0.08)_1px,transparent_0)] [background-size:22px_22px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.10)_1px,transparent_0)]" />
    </div>
  );
}

/** Light/dark toggle — drop anywhere; reads & flips the global theme. */
export function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle dark mode"
      className={`grid h-9 w-9 place-items-center rounded-xl bg-white/70 text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-indigo-600 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10 dark:hover:text-indigo-300 ${className}`}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function Logo({ onClick, subtitle = "AI Tutor" }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 select-none transition-transform hover:scale-[1.02]">
      <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-lg text-white shadow-lg shadow-indigo-500/30">🦉</div>
      <div className="text-left leading-tight">
        <p className="font-display font-extrabold tracking-tight text-slate-800 dark:text-white">Tuto<span className="text-indigo-500 dark:text-indigo-300">.ai</span></p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{subtitle}</p>
      </div>
    </button>
  );
}

export function Button({ children, variant = "primary", className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-2xl font-extrabold transition-all active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100";
  const styles = {
    primary: "bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 px-5 py-3",
    ghost: "bg-white/70 text-slate-700 ring-1 ring-slate-200 hover:bg-white px-5 py-3",
    soft: "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-5 py-3",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props}>{children}</button>;
}

export function Badge({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-indigo-600 ring-1 ring-indigo-100 ${className}`}>
      <Sparkles className="h-3.5 w-3.5" /> {children}
    </span>
  );
}

export function Card({ children, className = "" }) {
  return <div className={`rounded-3xl border border-white/60 bg-white/75 shadow-lg shadow-slate-200/40 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 dark:shadow-black/20 ${className}`}>{children}</div>;
}

export function AppHeader({ user, onLogout, right }) {
  const roleLabel = { admin: "Admin", student: "Student", parent: "Parent" }[user?.role] || "";
  return (
    <header className="sticky top-0 z-20 border-b border-white/40 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Logo subtitle={roleLabel} />
        <div className="flex items-center gap-3">
          {right}
          <ThemeToggle />
          <span className="hidden text-sm font-bold text-slate-600 dark:text-slate-300 sm:block">{user?.name}</span>
          <button onClick={onLogout} className="grid h-9 w-9 place-items-center rounded-xl bg-white/70 text-slate-500 ring-1 ring-slate-200 hover:text-rose-500 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10 dark:hover:text-rose-400" title="Log out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500 dark:border-slate-700 dark:border-t-indigo-400" />
      <span className="font-bold">{label}</span>
    </div>
  );
}
