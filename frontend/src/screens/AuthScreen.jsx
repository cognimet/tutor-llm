import React, { useState } from "react";
import {
  GraduationCap, Users, ShieldCheck, ArrowRight, Sparkles, Mail, Lock, User,
  Eye, EyeOff, Check, MessageSquare, Target, TrendingUp, Loader2, BookOpen,
} from "lucide-react";
import CurriculumPicker from "../ui/CurriculumPicker.jsx";
import { ThemeToggle } from "../ui/components.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const ROLES = [
  { id: "student", label: "Student", icon: GraduationCap, desc: "Learn with your friendly tutor" },
  { id: "parent", label: "Parent", icon: Users, desc: "Track your child's progress" },
];

const DEMOS = [
  { role: "Student", email: "student@tuto.ai", icon: GraduationCap },
  { role: "Parent", email: "parent@tuto.ai", icon: Users },
  { role: "Admin", email: "admin@tuto.ai", icon: ShieldCheck },
];

const FEATURES = [
  { icon: MessageSquare, title: "Topic-by-topic tutor chat" },
  { icon: Target, title: "Quick quizzes + Focus Areas" },
  { icon: TrendingUp, title: "Personalised plan & progress" },
];

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("student");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [curr, setCurr] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isRegister = mode === "register";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (isRegister && role === "student" && !curr) {
      setError("Pick your stage, board and class to continue.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await login({ email: form.email, password: form.password });
      } else {
        await register({
          name: form.name, email: form.email, password: form.password, role,
          ...(role === "student" ? { level_id: curr.level_id, stream: curr.stream, board: curr.board, grade: curr.grade } : {}),
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || Object.values(err.response?.data?.errors || {})[0]?.[0] || "Something went wrong.");
    } finally { setBusy(false); }
  };

  const demoLogin = async (email) => {
    setError(""); setBusy(true);
    try { await login({ email, password: "password" }); }
    catch { setError("Demo login failed — is the backend seeded and running?"); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-800 lg:grid lg:grid-cols-[1.1fr_1fr]">
      <ThemeToggle className="fixed right-4 top-4 z-20" />
      <BrandPanel />

      {/* --------------------------------------------------------- Form side */}
      <div className="flex min-h-screen flex-col justify-center px-5 py-10 sm:px-10">
        <div className="auth-rise mx-auto w-full max-w-[400px]">
          {/* Mobile brand mark */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg text-white shadow-lg shadow-indigo-500/30">🦉</span>
            <div className="leading-tight">
              <p className="font-display text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">Tuto<span className="text-indigo-500">.ai</span></p>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Your Study Buddy</p>
            </div>
          </div>

          {/* Segmented control */}
          <div className="relative flex rounded-2xl bg-slate-100 dark:bg-white/10 p-1">
            <span
              className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-200/70 transition-transform duration-300 ease-out"
              style={{ transform: isRegister ? "translateX(100%)" : "translateX(0)" }}
            />
            {["login", "register"].map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setError(""); }}
                className={`relative z-10 flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors ${mode === m ? "text-indigo-600 dark:text-indigo-300" : "text-slate-500 dark:text-slate-400 hover:text-slate-700"}`}>
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <div className="mt-7">
            <h1 className="font-display text-[1.7rem] font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white">
              {isRegister ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-1 text-[15px] text-slate-500 dark:text-slate-400">
              {isRegister ? "Start learning in under a minute — it's free." : "Log in to pick up where you left off."}
            </p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {isRegister && (
              <div>
                <FieldLabel>I am a…</FieldLabel>
                <div className="grid grid-cols-2 gap-2.5">
                  {ROLES.map((r) => {
                    const active = role === r.id;
                    return (
                      <button type="button" key={r.id} onClick={() => setRole(r.id)}
                        className={`group relative flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${active ? "border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500" : "border-slate-200 dark:border-white/10 hover:border-slate-300 hover:bg-slate-50 dark:bg-white/5"}`}>
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${active ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 group-hover:bg-slate-200"}`}>
                          <r.icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{r.label}</span>
                          <span className="block truncate text-[11px] text-slate-400">{r.desc}</span>
                        </span>
                        {active && (
                          <span className="absolute right-2.5 top-2.5 grid h-4 w-4 place-items-center rounded-full bg-indigo-500 text-white">
                            <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {isRegister && (
              <Field label="Full name" icon={User} value={form.name} onChange={set("name")} placeholder="Aarav Sharma" autoComplete="name" required />
            )}

            <Field label="Email" icon={Mail} type="email" value={form.email} onChange={set("email")}
                   placeholder="you@example.com" autoComplete="email" required />

            <Field label="Password" icon={Lock} type={showPwd ? "text" : "password"} value={form.password}
                   onChange={set("password")} placeholder="Enter your password"
                   autoComplete={isRegister ? "new-password" : "current-password"} required
                   trailing={
                     <button type="button" onClick={() => setShowPwd((v) => !v)} tabIndex={-1}
                       className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
                       aria-label={showPwd ? "Hide password" : "Show password"}>
                       {showPwd ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                     </button>
                   } />

            {isRegister && role === "student" && (
              <div>
                <FieldLabel>
                  <BookOpen className="h-3.5 w-3.5 text-indigo-500" /> Where are you studying?
                </FieldLabel>
                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/5 p-4">
                  <CurriculumPicker value={curr?.level_id} onChange={setCurr} />
                  {curr && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={3} />
                      <span>You're set — <span className="font-bold">{curr.label}</span></span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-semibold text-rose-600 ring-1 ring-rose-100">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy}
              className="group mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-[15px] font-bold text-white shadow-lg shadow-indigo-500/25 ring-1 ring-inset ring-white/10 transition-all hover:shadow-xl hover:shadow-indigo-500/30 active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100">
              {busy ? (
                <><Loader2 className="h-[18px] w-[18px] animate-spin" /> Please wait…</>
              ) : (
                <>{isRegister ? "Create account" : "Log in"}
                  <ArrowRight className="h-[18px] w-[18px] transition-transform group-hover:translate-x-0.5" /></>
              )}
            </button>

            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
              <Lock className="h-3 w-3" /> No spam · your learning data stays private
            </p>
          </form>

          {/* Demo accounts */}
          <div className="mt-7">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Or try a demo</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              {DEMOS.map((d) => (
                <button key={d.email} onClick={() => demoLogin(d.email)} disabled={busy}
                  className="group flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 py-3 text-xs font-bold text-slate-600 dark:text-slate-300 transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-md disabled:opacity-50">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 transition-colors group-hover:bg-indigo-100 group-hover:text-indigo-600">
                    <d.icon className="h-4 w-4" />
                  </span>
                  {d.role}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-7 text-center text-[11px] leading-relaxed text-slate-400">
            By continuing you agree to our Terms of Service & Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Brand panel */

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-violet-700 p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
      {/* ambient light + texture */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-20 -top-24 h-96 w-96 rounded-full bg-white/15 blur-3xl" />
        <div className="absolute -bottom-24 -left-20 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.14)_1px,transparent_0)] [background-size:26px_26px] opacity-40" />
      </div>

      {/* logo */}
      <div className="relative flex items-center gap-2.5">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 text-xl ring-1 ring-white/25 backdrop-blur">🦉</span>
        <div className="leading-tight">
          <p className="font-display text-lg font-extrabold tracking-tight">Tuto<span className="text-indigo-200">.ai</span></p>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Your Study Buddy</p>
        </div>
      </div>

      {/* headline */}
      <div className="relative max-w-md">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur">
          <Sparkles className="h-3.5 w-3.5" /> Built for the Indian syllabus
        </span>
        <h2 className="mt-6 font-display text-[2.9rem] font-extrabold leading-[1.05] tracking-tight">
          Your personal study buddy that <span className="text-indigo-200">actually gets you</span>
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-white/70">
          Ask any doubt, take a quick check, and get a focused plan for exactly what you misunderstand.
        </p>
        <ul className="mt-8 space-y-3.5">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-center gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/20">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              <span className="text-[15px] font-semibold text-white/90">{f.title}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* grounded-in card */}
      <div className="relative rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/60">Grounded in NCERT · Class 10</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {["📘 Mathematics", "🔬 Science", "🌏 Social Science"].map((c) => (
            <span key={c} className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-bold ring-1 ring-white/10">{c}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- form bits */

function FieldLabel({ children }) {
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-200">{children}</span>
  );
}

function Field({ label, icon: Icon, trailing, ...props }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />}
        <input
          {...props}
          className={`h-12 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 text-[15px] font-medium text-slate-800 dark:text-slate-100 outline-none transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 ${Icon ? "pl-10" : "pl-3.5"} ${trailing ? "pr-12" : "pr-3.5"}`}
        />
        {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
    </label>
  );
}
