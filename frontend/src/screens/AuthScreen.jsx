import React, { useState } from "react";
import { GraduationCap, Users, ShieldCheck, ArrowRight, Sparkles } from "lucide-react";
import { Backdrop, Logo, Button } from "../ui/components.jsx";
import CurriculumPicker from "../ui/CurriculumPicker.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const ROLES = [
  { id: "student", label: "Student", icon: GraduationCap, desc: "Learn with your AI tutor" },
  { id: "parent", label: "Parent", icon: Users, desc: "Track your child's progress" },
];

const DEMOS = [
  { role: "Student", email: "student@tuto.ai", icon: GraduationCap },
  { role: "Parent", email: "parent@tuto.ai", icon: Users },
  { role: "Admin", email: "admin@tuto.ai", icon: ShieldCheck },
];

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("student");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [curr, setCurr] = useState(null); // { level_id, stream, board, grade, label }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (mode === "register" && role === "student" && !curr) {
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
    <div className="min-h-screen">
      <Backdrop />
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
        {/* Hero */}
        <div className="hidden lg:block">
          <Logo />
          <h1 className="mt-10 text-5xl font-extrabold leading-[1.1] tracking-tight text-slate-900">
            Your personal AI tutor that{" "}
            <span className="bg-gradient-to-br from-indigo-500 to-violet-500 bg-clip-text text-transparent">actually gets you</span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-slate-500">
            Ask any doubt, take a quick check, and get a focused plan for exactly what you misunderstand — built for the Indian syllabus.
          </p>
          <div className="mt-8 space-y-3">
            {["Topic-wise AI tutor chat", "Mini-assessment + gap detection", "Personalized next-steps & progress"].map((t) => (
              <p key={t} className="flex items-center gap-3 font-bold text-slate-700">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-50 text-indigo-600"><Sparkles className="h-3.5 w-3.5" /></span>{t}
              </p>
            ))}
          </div>
        </div>

        {/* Auth card */}
        <div className="mx-auto w-full max-w-md rounded-3xl border border-white/60 bg-white/80 p-7 shadow-xl shadow-slate-200/50 backdrop-blur-sm">
          <div className="lg:hidden"><Logo /></div>
          <div className="mt-4 flex rounded-2xl bg-slate-100 p-1">
            {["login", "register"].map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 rounded-xl py-2 text-sm font-extrabold capitalize transition-all ${mode === m ? "bg-white text-indigo-600 shadow" : "text-slate-500"}`}>
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "register" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map((r) => (
                    <button type="button" key={r.id} onClick={() => setRole(r.id)}
                      className={`rounded-2xl border p-3 text-left transition-all ${role === r.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                      <r.icon className={`h-5 w-5 ${role === r.id ? "text-indigo-600" : "text-slate-400"}`} />
                      <p className="mt-1 text-sm font-extrabold text-slate-800">{r.label}</p>
                      <p className="text-[11px] text-slate-400">{r.desc}</p>
                    </button>
                  ))}
                </div>
                <Field label="Full name" value={form.name} onChange={set("name")} placeholder="Aarav Sharma" required />
              </>
            )}

            <Field label="Email" type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" required />
            <Field label="Password" type="password" value={form.password} onChange={set("password")} placeholder="••••••••" required />

            {mode === "register" && role === "student" && (
              <div className="rounded-2xl border border-slate-200 bg-white/60 p-3">
                <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Where are you studying?</p>
                <CurriculumPicker value={curr?.level_id} onChange={setCurr} />
                {curr && (
                  <p className="mt-2 text-[11px] font-bold text-indigo-600">📚 {curr.label}</p>
                )}
              </div>
            )}

            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{error}</p>}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"} <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="mt-6">
            <p className="text-center text-xs font-bold uppercase tracking-wide text-slate-400">Or try a demo account</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {DEMOS.map((d) => (
                <button key={d.email} onClick={() => demoLogin(d.email)} disabled={busy}
                  className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-3 text-xs font-bold text-slate-600 transition-all hover:border-indigo-300 hover:text-indigo-600">
                  <d.icon className="h-4 w-4" /> {d.role}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <input {...props} className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200" />
    </label>
  );
}
