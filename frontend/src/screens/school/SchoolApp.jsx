import React, { useEffect, useState } from "react";
import { Backdrop, AppHeader, Card, Spinner, Button } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { schoolApi } from "../../api/endpoints.js";
import {
  Building2, Users, GraduationCap, LayoutGrid, BarChart3, PlusCircle,
  Upload, Trash2, ListChecks, Brain, AlertTriangle, Activity, TrendingUp,
  Trophy, BookOpen, Flame, ArrowLeft, Target, CheckCircle2,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

const apiError = (err, fallback) =>
  err.response?.data?.message
  || Object.values(err.response?.data?.errors || {})[0]?.[0]
  || fallback;

export default function SchoolApp() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState(null);   // {type:'class'|'section'|'student', id, name}

  const TABS = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "classes", label: "Classes", icon: LayoutGrid },
    { id: "teachers", label: "Teachers", icon: GraduationCap },
    { id: "students", label: "Students", icon: Users },
  ];

  // Drill-in navigation shared by every child screen.
  const nav = {
    openClass:   (id, name) => setDetail({ type: "class", id, name }),
    openSection: (id, name) => setDetail({ type: "section", id, name }),
    openStudent: (id) => setDetail({ type: "student", id }),
  };
  const back = () => setDetail(null);

  return (
    <div className="min-h-screen">
      <Backdrop />
      <AppHeader user={user} onLogout={logout} />
      <div className="mx-auto max-w-6xl px-5 py-8">
        {detail ? (
          detail.type === "class" ? <ClassView classId={detail.id} name={detail.name} nav={nav} onBack={back} /> :
          detail.type === "section" ? <SectionView sectionId={detail.id} name={detail.name} nav={nav} onBack={back} /> :
          <StudentReport studentId={detail.id} onBack={back} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Building2 className="h-6 w-6" /></div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">School admin</h1>
                <p className="text-slate-500 dark:text-slate-400">Manage classes, teachers, and students.</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-white/10 sm:w-fit">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold ${tab === t.id ? "bg-indigo-50 text-indigo-600" : "text-slate-500 dark:text-slate-400"}`}>
                  <t.icon className="h-4 w-4" /> {t.label}
                </button>
              ))}
            </div>

            <div className="mt-6">
              {tab === "overview" && <Overview nav={nav} />}
              {tab === "classes" && <Classes nav={nav} />}
              {tab === "teachers" && <Teachers />}
              {tab === "students" && <Students nav={nav} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------- Overview -------------------- */
function Overview({ nav }) {
  const [data, setData] = useState(null);
  useEffect(() => { schoolApi.overview().then(setData); }, []);
  if (!data) return <Spinner label="Loading overview…" />;
  const c = data.counts || {}, k = data.kpis || {}, g = data.gaps || {};
  const seat = data.school?.seat_limit ? ` / ${data.school.seat_limit}` : "";

  return (
    <div className="space-y-5">
      {/* KPI row — the "how is my school doing right now" strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={Brain} label="Avg mastery" value={`${k.avg_mastery ?? 0}%`} tone={masteryTone(k.avg_mastery ?? 0)} />
        <Stat icon={AlertTriangle} label="Students at risk" value={k.at_risk ?? 0} tone={(k.at_risk ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"} />
        <Stat icon={Activity} label="Active this week" value={`${k.active_7d ?? 0} / ${c.students ?? 0}`} />
        <Stat icon={Users} label="Students" value={`${c.students ?? 0}${seat}`} sub={`${c.teachers ?? 0} teachers · ${c.sections ?? 0} sections`} />
      </div>

      {/* Mastery trend */}
      <Card className="p-5">
        <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <TrendingUp className="h-4 w-4 text-indigo-500" /> School mastery — last 14 days
        </p>
        <TrendChart data={data.mastery_trend} />
      </Card>

      {/* Engagement breakdown */}
      <Card className="p-5">
        <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Activity className="h-4 w-4 text-emerald-500" /> Engagement
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <Mini label="Active today" value={data.engagement?.active_today ?? 0} tone="text-emerald-600" />
          <Mini label="Active this week" value={data.engagement?.active_7d ?? 0} />
          <Mini label="Inactive 7d+" value={data.engagement?.inactive_7d ?? 0} tone="text-rose-600" />
          <Mini label="Avg streak 🔥" value={data.engagement?.avg_streak ?? 0} />
        </div>
      </Card>

      {/* Class performance — class-wise rollup with sections nested inside */}
      <Card className="p-5">
        <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <LayoutGrid className="h-4 w-4 text-indigo-500" /> Class performance
        </p>
        <div className="mt-3 space-y-4">
          {(data.classes || []).map((cl) => (
            <div key={cl.class} className="rounded-2xl border border-slate-100 dark:border-white/10 p-4">
              <button onClick={() => nav.openClass(cl.class_id, cl.class)} className="flex w-full items-center justify-between text-left hover:opacity-80">
                <div>
                  <p className="text-base font-extrabold text-slate-900 dark:text-white underline-offset-2 hover:underline">{cl.class} →</p>
                  <p className="text-xs text-slate-400">{cl.students} students · {cl.section_count} section{cl.section_count === 1 ? "" : "s"} · {cl.open_gaps} gaps{cl.at_risk > 0 ? ` · ${cl.at_risk} at risk` : ""}</p>
                </div>
                <span className={`text-xl font-extrabold ${masteryTone(cl.avg_mastery)}`}>{cl.avg_mastery}%</span>
              </button>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className={`h-full rounded-full ${barTone(cl.avg_mastery)}`} style={{ width: `${Math.max(3, cl.avg_mastery)}%` }} />
              </div>
              <div className="mt-3 space-y-1 border-t border-slate-100 dark:border-white/10 pt-3">
                {(cl.sections || []).map((s) => (
                  <button key={s.name} onClick={() => nav.openSection(s.id, `${cl.class} · ${s.name}`)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-white/5">
                    <span className="w-20 shrink-0 text-left font-bold text-slate-600 dark:text-slate-300">Sec {s.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <div className={`h-full rounded-full ${barTone(s.avg_mastery)}`} style={{ width: `${Math.max(3, s.avg_mastery)}%` }} />
                    </div>
                    <span className="hidden w-24 shrink-0 text-right text-xs text-slate-400 sm:inline">{s.students} · {s.at_risk} at risk</span>
                    <span className={`w-10 shrink-0 text-right font-extrabold ${masteryTone(s.avg_mastery)}`}>{s.avg_mastery}%</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {(data.classes || []).length === 0 && <p className="text-sm text-slate-400">Add classes, sections and students to compare.</p>}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Section comparison — all sections ranked, regardless of class */}
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Section leaderboard</p>
          <div className="mt-3 space-y-3">
            {(data.sections || []).map((s) => (
              <button key={s.label} onClick={() => nav.openSection(s.id, s.label)} className="block w-full text-left">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-extrabold text-slate-700 dark:text-slate-200 hover:underline">{s.label}</span>
                  <span className="text-slate-400">{s.students} students · {s.open_gaps} gaps{s.at_risk > 0 ? ` · ${s.at_risk} at risk` : ""}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div className={`h-full rounded-full ${barTone(s.avg_mastery)}`} style={{ width: `${Math.max(3, s.avg_mastery)}%` }} />
                  </div>
                  <span className={`w-10 text-right text-sm font-extrabold ${masteryTone(s.avg_mastery)}`}>{s.avg_mastery}%</span>
                </div>
              </button>
            ))}
            {(data.sections || []).length === 0 && <p className="text-sm text-slate-400">Add sections and students to compare.</p>}
          </div>
        </Card>

        {/* Students at risk — intervene first */}
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <AlertTriangle className="h-4 w-4 text-rose-500" /> Students needing attention
          </p>
          <div className="mt-3 space-y-2">
            {(data.at_risk_students || []).map((s) => (
              <button key={s.id} onClick={() => nav.openStudent(s.id)} className="flex w-full items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3 text-left hover:ring-1 hover:ring-indigo-300">
                <div><p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{s.name}</p><p className="text-xs text-slate-400">{s.section} · {s.high_gaps} high-priority gaps</p></div>
                <span className={`text-sm font-extrabold ${masteryTone(s.mastery)}`}>{s.mastery}%</span>
              </button>
            ))}
            {(data.at_risk_students || []).length === 0 && <p className="text-sm text-slate-400">Nobody flagged — the whole school is on track. 🎉</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Teacher effectiveness */}
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <GraduationCap className="h-4 w-4 text-indigo-500" /> Teacher effectiveness
          </p>
          <div className="mt-3 space-y-2">
            {(data.teachers || []).map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-slate-700 dark:text-slate-200">{t.name}</span>
                <span className="hidden text-xs text-slate-400 sm:inline">{t.students} students · {t.assignments} assigned</span>
                {t.at_risk > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-extrabold text-rose-600">{t.at_risk} at risk</span>}
                <span className={`w-10 text-right text-sm font-extrabold ${masteryTone(t.avg_mastery)}`}>{t.avg_mastery}%</span>
              </div>
            ))}
            {(data.teachers || []).length === 0 && <p className="text-sm text-slate-400">No teachers yet.</p>}
          </div>
        </Card>

        {/* Honour roll */}
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Trophy className="h-4 w-4 text-amber-500" /> Top performers
          </p>
          <div className="mt-3 space-y-2">
            {(data.top_performers || []).map((s, i) => (
              <button key={s.id} onClick={() => nav.openStudent(s.id)} className="flex w-full items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3 text-left hover:ring-1 hover:ring-indigo-300">
                <div className="flex items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-50 text-xs font-extrabold text-amber-600">{i + 1}</span>
                  <div><p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{s.name}</p><p className="text-xs text-slate-400">{s.section} · 🔥 {s.streak}</p></div>
                </div>
                <span className="text-sm font-extrabold text-emerald-600">{s.mastery}%</span>
              </button>
            ))}
            {(data.top_performers || []).length === 0 && <p className="text-sm text-slate-400">Builds up as students learn.</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Open gaps</p>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Mini label="Open" value={g.open ?? 0} />
            <Mini label="High" value={g.high ?? 0} tone="text-rose-600" />
            <Mini label="Medium" value={g.medium ?? 0} tone="text-amber-600" />
            <Mini label="Low" value={g.low ?? 0} tone="text-emerald-600" />
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Most common weak concepts</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(data.gap_clusters || []).map((x) => (
              <span key={x.concept} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-600">
                {x.concept} · {x.c}{Number(x.high) > 0 ? <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{x.high} high</span> : null}
              </span>
            ))}
            {(data.gap_clusters || []).length === 0 && <p className="text-sm text-slate-400">Builds up as students learn.</p>}
          </div>
        </Card>
      </div>

      {/* Topic hotspots — which topics need reteaching school-wide */}
      <Card className="p-5">
        <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <BookOpen className="h-4 w-4 text-amber-500" /> Topics with the most gaps
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(data.topic_hotspots || []).map((t) => (
            <span key={t.topic_name} className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700">{t.topic_name} · {t.c} gaps</span>
          ))}
          {(data.topic_hotspots || []).length === 0 && <p className="text-sm text-slate-400">No gaps yet.</p>}
        </div>
      </Card>
    </div>
  );
}

function TrendChart({ data = [] }) {
  return (
    <div className="mt-3 h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="mGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" hide /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString()} formatter={(v) => [`${v}%`, "Mastery"]} />
          <Area type="monotone" dataKey="mastery" stroke="#6366f1" strokeWidth={2.5} fill="url(#mGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------- Classes & sections -------------------- */
function Classes({ nav }) {
  const [classes, setClasses] = useState(null);
  const [msg, setMsg] = useState("");
  const [newClass, setNewClass] = useState("");
  const load = async () => setClasses(await schoolApi.classes());
  useEffect(() => { load(); }, []);

  const addClass = async (e) => {
    e.preventDefault(); setMsg("");
    if (!newClass.trim()) return;
    try { await schoolApi.createClass({ name: newClass.trim() }); setNewClass(""); await load(); }
    catch (err) { setMsg(apiError(err, "Could not create class.")); }
  };
  const addSection = async (classId, name) => {
    try { await schoolApi.createSection(classId, { name }); await load(); }
    catch (err) { setMsg(apiError(err, "Could not add section.")); }
  };
  const delSection = async (id) => {
    if (!confirm("Delete this section?")) return;
    try { await schoolApi.deleteSection(id); await load(); }
    catch (err) { setMsg(apiError(err, "Could not delete section.")); }
  };

  if (!classes) return <Spinner label="Loading classes…" />;
  return (
    <div className="space-y-4">
      <form onSubmit={addClass} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">New class</span>
          <input value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="e.g. Grade 10" className={inputCls} />
        </label>
        <Button type="submit"><PlusCircle className="h-4 w-4" /> Add class</Button>
      </form>
      {msg && <p className="text-sm font-semibold text-rose-600">{msg}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {classes.map((cl) => <ClassCard key={cl.id} cl={cl} nav={nav} onAddSection={addSection} onDelSection={delSection} />)}
        {classes.length === 0 && <Card className="p-10 text-center text-slate-400 sm:col-span-2">No classes yet. Add one above.</Card>}
      </div>
    </div>
  );
}

function ClassCard({ cl, nav, onAddSection, onDelSection }) {
  const [name, setName] = useState("");
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-lg font-extrabold text-slate-900 dark:text-white">{cl.name}</p>
        <button onClick={() => nav.openClass(cl.id, cl.name)} className="inline-flex items-center gap-1 text-xs font-extrabold text-indigo-600 hover:underline"><BarChart3 className="h-3.5 w-3.5" /> Insights</button>
      </div>
      <div className="mt-3 space-y-2">
        {(cl.sections || []).map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2">
            <button onClick={() => nav.openSection(s.id, `${cl.name} · ${s.name}`)} className="text-left text-sm font-bold text-slate-700 dark:text-slate-200 hover:text-indigo-600">Section {s.name} · <span className="text-slate-400">{s.students_count} students</span></button>
            <button onClick={() => onDelSection(s.id)} className="text-slate-300 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {(cl.sections || []).length === 0 && <p className="text-sm text-slate-400">No sections yet.</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAddSection(cl.id, name.trim()); setName(""); } }} className="mt-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Section (A)" className={`${inputCls} flex-1`} />
        <Button type="submit" variant="soft">Add</Button>
      </form>
    </Card>
  );
}

/* -------------------- Teachers -------------------- */
function Teachers() {
  const [teachers, setTeachers] = useState(null);
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", section_ids: [] });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => setTeachers(await schoolApi.teachers());
  useEffect(() => { load(); schoolApi.classes().then(setClasses); }, []);

  const sections = classes.flatMap((c) => (c.sections || []).map((s) => ({ id: s.id, label: `${c.name} · ${s.name}` })));

  const toggleSection = (id) => setForm((f) => ({
    ...f, section_ids: f.section_ids.includes(id) ? f.section_ids.filter((x) => x !== id) : [...f.section_ids, id],
  }));

  const submit = async (e) => {
    e.preventDefault(); setMsg("");
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) { setMsg("Name, email, and a 6+ char password are required."); return; }
    setBusy(true);
    try {
      await schoolApi.createTeacher({ name: form.name.trim(), email: form.email.trim(), password: form.password, section_ids: form.section_ids });
      setForm({ name: "", email: "", password: "", section_ids: [] }); await load();
    } catch (err) { setMsg(apiError(err, "Could not create teacher.")); }
    finally { setBusy(false); }
  };

  if (!teachers) return <Spinner label="Loading teachers…" />;
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Add a teacher</p>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name" className={inputCls} />
            <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} type="email" placeholder="Email" className={inputCls} />
            <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} type="password" placeholder="Temp password" className={inputCls} />
          </div>
          {sections.length > 0 && (
            <div>
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Assign to sections</span>
              <div className="flex flex-wrap gap-2">
                {sections.map((s) => (
                  <button type="button" key={s.id} onClick={() => toggleSection(s.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-extrabold ring-1 ${form.section_ids.includes(s.id) ? "bg-indigo-500 text-white ring-indigo-500" : "bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-white/10"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msg && <p className="text-sm font-semibold text-rose-600">{msg}</p>}
          <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create teacher"}</Button>
        </form>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {teachers.map((t) => (
          <Card key={t.id} className="p-4">
            <p className="font-extrabold text-slate-900 dark:text-white">{t.name}</p>
            <p className="text-xs text-slate-400">{t.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(t.taught_sections || []).map((s) => <span key={s.id} className="rounded-full bg-slate-50 dark:bg-white/5 px-2 py-0.5 text-[11px] font-extrabold text-slate-500 dark:text-slate-400">{s.name}</span>)}
              {(t.taught_sections || []).length === 0 && <span className="text-[11px] text-slate-400">No sections assigned</span>}
            </div>
          </Card>
        ))}
        {teachers.length === 0 && <Card className="p-10 text-center text-slate-400 sm:col-span-2">No teachers yet.</Card>}
      </div>
    </div>
  );
}

/* -------------------- Students + CSV import -------------------- */
function Students({ nav }) {
  const [students, setStudents] = useState(null);
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", section_id: "" });
  const [created, setCreated] = useState(null);   // { login_code, temp_password } from last create/import
  const [importResult, setImportResult] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => setStudents(await schoolApi.students());
  useEffect(() => { load(); schoolApi.classes().then(setClasses); }, []);
  const sections = classes.flatMap((c) => (c.sections || []).map((s) => ({ id: s.id, label: `${c.name} · ${s.name}` })));

  const submit = async (e) => {
    e.preventDefault(); setMsg(""); setCreated(null);
    if (!form.name.trim() || !form.section_id) { setMsg("Name and section are required."); return; }
    setBusy(true);
    try {
      const res = await schoolApi.createStudent({ name: form.name.trim(), email: form.email.trim() || undefined, section_id: Number(form.section_id) });
      setCreated({ name: res.student.name, login_code: res.student.login_code, temp_password: res.temp_password });
      setForm({ name: "", email: "", section_id: form.section_id }); await load();
    } catch (err) { setMsg(apiError(err, "Could not create student.")); }
    finally { setBusy(false); }
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setMsg(""); setImportResult(null);
    try { setImportResult(await schoolApi.importStudents(file)); await load(); }
    catch (err) { setMsg(apiError(err, "Import failed.")); }
    finally { setBusy(false); e.target.value = ""; }
  };

  if (!students) return <Spinner label="Loading students…" />;
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Add a student</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-slate-100 dark:bg-white/10 px-3.5 py-2 text-sm font-extrabold text-slate-600 dark:text-slate-300 hover:bg-slate-200">
            <Upload className="h-4 w-4" /> Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onImport} disabled={busy} />
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-400">CSV headers: <code>name,email,section_id,password</code> — email &amp; password optional (a login code + temp password are generated).</p>

        <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-4">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name" className={inputCls} />
          <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} type="email" placeholder="Email (optional)" className={inputCls} />
          <select value={form.section_id} onChange={(e) => setForm((f) => ({ ...f, section_id: e.target.value }))} className={inputCls}>
            <option value="">Select section…</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add student"}</Button>
        </form>
        {msg && <p className="mt-2 text-sm font-semibold text-rose-600">{msg}</p>}

        {created && (
          <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm ring-1 ring-emerald-100">
            <p className="font-extrabold text-emerald-700">{created.name} created</p>
            <p className="text-emerald-700">Login code: <b>{created.login_code}</b>{created.temp_password ? <> · Temp password: <b>{created.temp_password}</b></> : ""}</p>
          </div>
        )}
        {importResult && (
          <div className="mt-3 rounded-2xl bg-indigo-50/70 p-3 text-sm ring-1 ring-indigo-100">
            <p className="font-extrabold text-indigo-700">Imported {importResult.imported} student{importResult.imported === 1 ? "" : "s"}</p>
            {importResult.students?.length > 0 && (
              <div className="mt-2 max-h-48 overflow-auto rounded-xl bg-white/70 p-2">
                {importResult.students.map((s, i) => (
                  <div key={i} className="flex justify-between py-0.5 text-xs">
                    <span className="font-bold">{s.name}</span>
                    <span className="text-slate-500">{s.login_code}{s.temp_password ? ` · ${s.temp_password}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
            {(importResult.errors || []).length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-rose-600">{importResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            )}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Students ({students.total ?? students.data?.length ?? 0})</p>
        <div className="mt-3 space-y-2">
          {(students.data || []).map((s) => (
            <button key={s.id} onClick={() => nav.openStudent(s.id)} className="flex w-full items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3 text-left hover:ring-1 hover:ring-indigo-300">
              <div><p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{s.name}</p><p className="text-xs text-slate-400">{s.email || s.login_code}</p></div>
              <span className="rounded-full bg-slate-50 dark:bg-white/5 px-2.5 py-1 text-[11px] font-extrabold text-slate-500 dark:text-slate-400">Class {s.grade ?? "—"}</span>
            </button>
          ))}
          {(students.data || []).length === 0 && <p className="text-sm text-slate-400">No students yet. Add one above or import a CSV.</p>}
        </div>
      </Card>
    </div>
  );
}

/* -------------------- Class detail -------------------- */
function ClassView({ classId, name, nav, onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { schoolApi.classAnalytics(classId).then(setData).catch((e) => setErr(apiError(e, "Could not load this class."))); }, [classId]);

  if (err) return <div><BackBtn onBack={onBack} label="Back to school" /><Card className="p-10 text-center text-rose-500">{err}</Card></div>;
  if (!data) return <div><BackBtn onBack={onBack} label="Back to school" /><Spinner label="Crunching class insights…" /></div>;

  return (
    <div>
      <BackBtn onBack={onBack} label="Back to school" />
      <h1 className="text-3xl font-extrabold tracking-tight">{data.class?.name || name}</h1>
      <p className="text-slate-500 dark:text-slate-400">{data.kpis?.students ?? 0} students across {(data.sections || []).length} section{(data.sections || []).length === 1 ? "" : "s"}</p>

      <Card className="mt-6 p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sections in this class</p>
        <div className="mt-3 space-y-2">
          {(data.sections || []).map((s) => (
            <button key={s.id} onClick={() => nav.openSection(s.id, `${data.class?.name || name} · ${s.name}`)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2.5 hover:border-indigo-200">
              <span className="w-24 shrink-0 text-left text-sm font-extrabold text-slate-700 dark:text-slate-200">Section {s.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className={`h-full rounded-full ${barTone(s.avg_mastery)}`} style={{ width: `${Math.max(3, s.avg_mastery)}%` }} />
              </div>
              <span className="hidden w-28 shrink-0 text-right text-xs text-slate-400 sm:inline">{s.students} students · {s.at_risk} at risk</span>
              <span className={`w-10 shrink-0 text-right text-sm font-extrabold ${masteryTone(s.avg_mastery)}`}>{s.avg_mastery}%</span>
            </button>
          ))}
          {(data.sections || []).length === 0 && <p className="text-sm text-slate-400">No sections yet.</p>}
        </div>
      </Card>

      <div className="mt-5"><CohortBlock a={data} onStudent={nav.openStudent} /></div>
    </div>
  );
}

/* -------------------- Section detail -------------------- */
function SectionView({ sectionId, name, nav, onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { schoolApi.sectionAnalytics(sectionId).then(setData).catch((e) => setErr(apiError(e, "Could not load this section."))); }, [sectionId]);

  if (err) return <div><BackBtn onBack={onBack} label="Back to school" /><Card className="p-10 text-center text-rose-500">{err}</Card></div>;
  if (!data) return <div><BackBtn onBack={onBack} label="Back to school" /><Spinner label="Crunching section insights…" /></div>;
  const label = data.section?.class ? `${data.section.class} · ${data.section.name}` : (data.section?.name || name);

  return (
    <div>
      <BackBtn onBack={onBack} label="Back to school" />
      <h1 className="text-3xl font-extrabold tracking-tight">{label}</h1>
      <p className="text-slate-500 dark:text-slate-400">{data.kpis?.students ?? 0} students</p>
      <div className="mt-6"><CohortBlock a={data} onStudent={nav.openStudent} showAssignments /></div>
    </div>
  );
}

/* Shared cohort analytics block used by both class and section detail. */
function CohortBlock({ a, onStudent, showAssignments }) {
  const k = a.kpis || {}, d = a.distribution || {}, g = a.gaps || {};
  const total = (d.strong || 0) + (d.developing || 0) + (d.needs_help || 0) + (d.no_data || 0) || 1;
  const bars = [
    { label: "On track (≥80%)", v: d.strong || 0, cls: "bg-emerald-400" },
    { label: "Developing (50–79%)", v: d.developing || 0, cls: "bg-indigo-400" },
    { label: "Needs help (<50%)", v: d.needs_help || 0, cls: "bg-rose-400" },
    { label: "No activity yet", v: d.no_data || 0, cls: "bg-slate-300" },
  ];
  const clk = onStudent ? "cursor-pointer transition hover:ring-1 hover:ring-indigo-300" : "";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={Brain} label="Avg mastery" value={`${k.avg_mastery ?? 0}%`} tone={masteryTone(k.avg_mastery ?? 0)} />
        <Stat icon={AlertTriangle} label="Needs help" value={k.needs_help ?? 0} tone={(k.needs_help ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"} />
        <Stat icon={CheckCircle2} label="On track" value={k.on_track ?? 0} tone="text-emerald-600" />
        <Stat icon={Activity} label="Active this week" value={`${k.active_7d ?? 0} / ${k.students ?? 0}`} />
      </div>

      {a.focus && (
        <Card className="flex items-center gap-3 border-l-4 border-indigo-400 p-4">
          <Target className="h-5 w-5 shrink-0 text-indigo-500" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-extrabold text-slate-900 dark:text-white">Reteach next: {a.focus.concept}</span> — the most common gap here, affecting {a.focus.count} student{a.focus.count === 1 ? "" : "s"}.
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mastery distribution</p>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
            {bars.map((b) => b.v > 0 && <div key={b.label} className={b.cls} style={{ width: `${(b.v / total) * 100}%` }} title={`${b.label}: ${b.v}`} />)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {bars.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${b.cls}`} /><span className="text-slate-500 dark:text-slate-400">{b.label}</span>
                <span className="ml-auto font-extrabold text-slate-700 dark:text-slate-200">{b.v}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <TrendingUp className="h-4 w-4 text-indigo-500" /> Mastery — last 14 days
          </p>
          <TrendChart data={a.mastery_trend} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <BookOpen className="h-4 w-4 text-indigo-500" /> Mastery by topic
          </p>
          <div className="mt-3 space-y-3">
            {(a.topic_mastery || []).map((t) => (
              <div key={t.topic}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-extrabold text-slate-700 dark:text-slate-200">{t.topic}</span>
                  <span className={`font-extrabold ${masteryTone(t.mastery)}`}>{t.mastery}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div className={`h-full rounded-full ${barTone(t.mastery)}`} style={{ width: `${Math.max(4, t.mastery)}%` }} />
                </div>
              </div>
            ))}
            {(a.topic_mastery || []).length === 0 && <p className="text-sm text-slate-400">Builds up as students learn.</p>}
          </div>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Trophy className="h-4 w-4 text-amber-500" /> Top performers
          </p>
          <div className="mt-3 space-y-2">
            {(a.top_performers || []).map((s, i) => (
              <div key={s.id} onClick={onStudent ? () => onStudent(s.id) : undefined} className={`flex items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3 ${clk}`}>
                <div className="flex items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-50 text-xs font-extrabold text-amber-600">{i + 1}</span>
                  <div><p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{s.name}</p><p className="text-xs text-slate-400">🔥 {s.streak} day streak</p></div>
                </div>
                <span className="text-sm font-extrabold text-emerald-600">{s.mastery}%</span>
              </div>
            ))}
            {(a.top_performers || []).length === 0 && <p className="text-sm text-slate-400">Builds up as students learn.</p>}
          </div>
        </Card>
      </div>

      {(a.at_risk || []).length > 0 && (
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <AlertTriangle className="h-4 w-4 text-rose-500" /> Students needing attention
          </p>
          <div className="mt-3 space-y-2">
            {a.at_risk.map((s) => (
              <div key={s.id} onClick={onStudent ? () => onStudent(s.id) : undefined} className={`flex items-center justify-between rounded-2xl border border-rose-100 bg-rose-50/40 p-3 ${clk}`}>
                <div>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{s.name}</p>
                  <p className="text-xs text-slate-400">{s.top_concept ? `Weakest: ${s.top_concept} · ` : ""}{s.high_gaps} high gaps · active {s.last_active}</p>
                </div>
                <span className={`text-sm font-extrabold ${masteryTone(s.mastery)}`}>{s.mastery}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">All students</p>
        <div className="mt-3 space-y-1.5">
          {(a.students || []).map((s) => (
            <div key={s.id} onClick={onStudent ? () => onStudent(s.id) : undefined} className={`flex items-center gap-3 rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2 ${clk}`}>
              <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-slate-700 dark:text-slate-200">{s.name}</span>
              <span className="hidden text-xs text-slate-400 sm:inline">{s.open_gaps} gaps</span>
              <span className="hidden text-xs text-slate-400 sm:inline">🔥 {s.streak}</span>
              <span className="w-16 text-right text-xs text-slate-400">{s.active_7d ? "active" : s.last_active}</span>
              <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10 sm:block">
                <div className={`h-full rounded-full ${barTone(s.mastery)}`} style={{ width: `${Math.max(4, s.mastery)}%` }} />
              </div>
              <span className={`w-10 text-right text-sm font-extrabold ${masteryTone(s.mastery)}`}>{s.mastery}%</span>
            </div>
          ))}
          {(a.students || []).length === 0 && <p className="text-sm text-slate-400">Builds up as students chat and take quick checks.</p>}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Most common weak concepts</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(a.gap_clusters || []).map((c) => (
              <span key={c.concept} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-600">
                {c.concept} · {c.c}{Number(c.high) > 0 ? <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{c.high} high</span> : null}
              </span>
            ))}
            {(a.gap_clusters || []).length === 0 && <p className="text-sm text-slate-400">No weak concepts flagged yet.</p>}
          </div>
        </Card>
        {showAssignments && (
          <Card className="p-5">
            <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent assignments</p>
            <div className="mt-3 space-y-2">
              {(a.assignments || []).map((x) => (
                <div key={x.id} className="rounded-2xl border border-slate-100 dark:border-white/10 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-extrabold text-slate-700 dark:text-slate-200">{x.title}</span>
                    <span className="text-slate-400">{x.completed}/{x.total} done{x.avg_score != null ? ` · avg ${x.avg_score}%` : ""}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div className="h-full rounded-full bg-indigo-400" style={{ width: `${x.total ? (x.completed / x.total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
              {(a.assignments || []).length === 0 && <p className="text-sm text-slate-400">No assignments yet.</p>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* -------------------- Student report -------------------- */
function StudentReport({ studentId, onBack }) {
  const [report, setReport] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { schoolApi.studentReport(studentId).then(setReport).catch((e) => setErr(apiError(e, "Could not load this student."))); }, [studentId]);

  if (err) return <div><BackBtn onBack={onBack} label="Back to school" /><Card className="p-10 text-center text-rose-500">{err}</Card></div>;
  if (!report) return <div><BackBtn onBack={onBack} label="Back to school" /><Spinner label="Loading report…" /></div>;
  const p = report.progress;
  return (
    <div>
      <BackBtn onBack={onBack} label="Back to school" />
      <h1 className="text-3xl font-extrabold tracking-tight">{report.child.name}</h1>
      <p className="text-slate-500 dark:text-slate-400">{report.child.curriculum_path || `Class ${report.child.grade}`}</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={Brain} label="Mastery" value={`${p.mastery}%`} />
        <Stat icon={Target} label="Accuracy" value={`${p.accuracy}%`} />
        <Stat icon={ListChecks} label="Open gaps" value={p.open_gaps} />
        <Stat icon={Flame} label="Streak" value={`${p.streak_days}d`} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Open knowledge gaps</p>
          <div className="mt-3 space-y-2">
            {report.gaps.length === 0 && <p className="text-sm text-slate-400">No open gaps — great work!</p>}
            {report.gaps.map((gp) => (
              <div key={gp.id} className="flex items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3">
                <div><p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{gp.concept}</p><p className="text-xs text-slate-400">{gp.topic_name}</p></div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${sevCls(gp.severity)}`}>{gp.severity}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent assessments</p>
          <div className="mt-3 space-y-2">
            {report.recent_assessments.length === 0 && <p className="text-sm text-slate-400">No assessments yet.</p>}
            {report.recent_assessments.map((as) => (
              <div key={as.id} className="flex items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3">
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{as.topic_name}</p>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-extrabold text-indigo-600">{as.score}/{as.total}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

const BackBtn = ({ onBack, label = "Back" }) => (
  <button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 dark:text-slate-400 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" /> {label}</button>
);
const sevCls = (s) => ({ high: "bg-rose-100 text-rose-600", medium: "bg-amber-100 text-amber-600", low: "bg-emerald-100 text-emerald-600" }[s] || "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400");

const inputCls = "w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200";
const Stat = ({ icon: Icon, label, value, tone = "text-slate-900 dark:text-white", sub }) => (
  <Card className="p-4"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" /></div>
    <p className={`mt-3 text-2xl font-extrabold ${tone}`}>{value}</p><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
    {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}</Card>
);
const Mini = ({ label, value, tone = "text-slate-900 dark:text-white" }) => (
  <div className="rounded-2xl bg-slate-50 dark:bg-white/5 py-2"><p className={`text-lg font-extrabold ${tone}`}>{value}</p><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p></div>
);
const masteryTone = (m) => m >= 80 ? "text-emerald-600" : m >= 50 ? "text-indigo-600" : m > 0 ? "text-rose-500" : "text-slate-400";
const barTone = (m) => m >= 80 ? "bg-emerald-400" : m >= 50 ? "bg-indigo-400" : "bg-rose-400";
