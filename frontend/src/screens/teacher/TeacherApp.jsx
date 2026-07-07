import React, { useEffect, useState } from "react";
import { Backdrop, AppHeader, Card, Spinner, Button } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { teacherApi } from "../../api/endpoints.js";
import {
  Users, ArrowLeft, ClipboardList, BarChart3, Brain, Target, ListChecks,
  Flame, PlusCircle, Sparkles, AlertTriangle, Activity, TrendingUp, CheckCircle2,
  Trophy, BookOpen,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

const apiError = (err, fallback) =>
  err.response?.data?.message
  || Object.values(err.response?.data?.errors || {})[0]?.[0]
  || fallback;

export default function TeacherApp() {
  const { user, logout } = useAuth();
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState(null);   // selected section {id,name,class,students}
  const [cls, setCls] = useState(null);           // selected class {id,name}
  const [student, setStudent] = useState(null);   // selected student id for report

  useEffect(() => { (async () => {
    try { setScope(await teacherApi.scope()); } finally { setLoading(false); }
  })(); }, []);

  return (
    <div className="min-h-screen">
      <Backdrop />
      <AppHeader user={user} onLogout={logout} onHome={() => { setStudent(null); setSection(null); setCls(null); }} />
      <div className="mx-auto max-w-6xl px-5 py-8">
        {loading ? <Spinner label="Loading your classes…" /> :
          student ? <StudentReport studentId={student} onBack={() => setStudent(null)} /> :
          section ? <SectionView section={section} subjects={scope.subjects} onBack={() => setSection(null)} onStudent={setStudent} /> :
          cls ? <ClassView cls={cls} onBack={() => setCls(null)} onSection={setSection} onStudent={setStudent} /> :
          <TeacherHome scope={scope} onOpen={setSection} onOpenClass={setCls} />}
      </div>
    </div>
  );
}

function TeacherHome({ scope, onOpen, onOpenClass }) {
  const [tab, setTab] = useState("overview");
  const TABS = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "classes", label: "My classes", icon: Users },
  ];
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">Teacher panel</h1>
      <p className="text-slate-500 dark:text-slate-400">Compare your classes and sections, then drill in to teach.</p>

      <div className="mt-5 flex gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-white/10 sm:w-fit">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold ${tab === t.id ? "bg-indigo-50 text-indigo-600" : "text-slate-500 dark:text-slate-400"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "overview" && <ScopeOverview onOpen={onOpen} onOpenClass={onOpenClass} />}
        {tab === "classes" && <SectionList scope={scope} onOpen={onOpen} />}
      </div>
    </>
  );
}

/* Cross-section overview: class-wise and section-wise, side by side. */
function ScopeOverview({ onOpen, onOpenClass }) {
  const [data, setData] = useState(null);
  useEffect(() => { teacherApi.overview().then(setData); }, []);
  if (!data) return <Spinner label="Crunching your classes…" />;
  const k = data.kpis || {};

  return (
    <div className="space-y-5">
      {/* KPI row across everything the teacher owns */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={Brain} label="Avg mastery" value={`${k.avg_mastery ?? 0}%`} tone={masteryTone(k.avg_mastery ?? 0)} />
        <Stat icon={AlertTriangle} label="At risk" value={k.at_risk ?? 0} tone={(k.at_risk ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"} />
        <Stat icon={Activity} label="Active this week" value={`${k.active_7d ?? 0} / ${k.students ?? 0}`} />
        <Stat icon={Users} label="Scope" value={`${k.sections ?? 0} sections`} />
      </div>

      {/* Class performance — class-wise rollup with sections nested (clickable) */}
      <Card className="p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Class performance</p>
        <div className="mt-3 space-y-4">
          {(data.classes || []).map((cl) => (
            <div key={cl.class} className="rounded-2xl border border-slate-100 dark:border-white/10 p-4">
              <button onClick={() => onOpenClass({ id: cl.class_id, name: cl.class })} className="flex w-full items-center justify-between text-left hover:opacity-80">
                <div>
                  <p className="text-base font-extrabold text-slate-900 dark:text-white underline-offset-2 hover:underline">{cl.class} →</p>
                  <p className="text-xs text-slate-400">{cl.students} students · {cl.section_count} section{cl.section_count === 1 ? "" : "s"} · {cl.open_gaps} gaps{cl.at_risk > 0 ? ` · ${cl.at_risk} at risk` : ""}</p>
                </div>
                <span className={`text-xl font-extrabold ${masteryTone(cl.avg_mastery)}`}>{cl.avg_mastery}%</span>
              </button>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className={`h-full rounded-full ${barTone(cl.avg_mastery)}`} style={{ width: `${Math.max(3, cl.avg_mastery)}%` }} />
              </div>
              <div className="mt-3 space-y-1.5 border-t border-slate-100 dark:border-white/10 pt-3">
                {(cl.sections || []).map((s) => (
                  <button key={s.id} onClick={() => onOpen({ id: s.id, name: s.name, class: s.class, students: s.students })}
                    className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-white/5">
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
          {(data.classes || []).length === 0 && <p className="text-sm text-slate-400">No sections assigned yet.</p>}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Section leaderboard — all sections ranked, click to open */}
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Section leaderboard</p>
          <div className="mt-3 space-y-2">
            {(data.sections || []).map((s) => (
              <button key={s.id} onClick={() => onOpen({ id: s.id, name: s.name, class: s.class, students: s.students })}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2 hover:border-indigo-200">
                <span className="min-w-0 flex-1 truncate text-left text-sm font-extrabold text-slate-700 dark:text-slate-200">{s.class} · {s.name}</span>
                {s.at_risk > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-extrabold text-rose-600">{s.at_risk} at risk</span>}
                <span className={`w-10 text-right text-sm font-extrabold ${masteryTone(s.avg_mastery)}`}>{s.avg_mastery}%</span>
              </button>
            ))}
            {(data.sections || []).length === 0 && <p className="text-sm text-slate-400">No sections yet.</p>}
          </div>
        </Card>

        {/* Topics to reteach across every section */}
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <BookOpen className="h-4 w-4 text-indigo-500" /> Weakest topics (all sections)
          </p>
          <div className="mt-3 space-y-3">
            {(data.topic_mastery || []).map((t) => (
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
            {(data.topic_mastery || []).length === 0 && <p className="text-sm text-slate-400">Builds up as students learn.</p>}
          </div>
        </Card>
      </div>

      {/* Weakest concepts across the whole scope */}
      <Card className="p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Most common weak concepts</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(data.gap_clusters || []).map((c) => (
            <span key={c.concept} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-600">
              {c.concept} · {c.c}{Number(c.high) > 0 ? <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{c.high} high</span> : null}
            </span>
          ))}
          {(data.gap_clusters || []).length === 0 && <p className="text-sm text-slate-400">No weak concepts flagged yet.</p>}
        </div>
      </Card>
    </div>
  );
}

function SectionList({ scope, onOpen }) {
  const sections = scope.sections || [];
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <button key={s.id} onClick={() => onOpen(s)} className="text-left">
            <Card className="p-6 transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-2xl">🏫</div>
                <div>
                  <p className="text-lg font-extrabold text-slate-900 dark:text-white">{s.class} · {s.name}</p>
                  <p className="text-sm text-slate-400">{s.students} student{s.students === 1 ? "" : "s"}</p>
                </div>
              </div>
            </Card>
          </button>
        ))}
        {sections.length === 0 && (
          <Card className="p-10 text-center text-slate-400 sm:col-span-2 lg:col-span-3">
            No sections assigned yet. Ask your school admin to add you to a section.
          </Card>
        )}
      </div>

      {(scope.subjects || []).length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {scope.subjects.map((s) => (
            <span key={s.id} className="rounded-full bg-slate-50 dark:bg-white/5 px-3 py-1.5 text-xs font-extrabold text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-white/10">
              {s.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function SectionView({ section, subjects, onBack, onStudent }) {
  const [tab, setTab] = useState("roster");
  const [roster, setRoster] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [assignments, setAssignments] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const loadRoster = async () => setRoster(await teacherApi.roster(section.id));
  useEffect(() => { loadRoster(); }, [section.id]);
  useEffect(() => { if (tab === "analytics" && !analytics) teacherApi.sectionAnalytics(section.id).then(setAnalytics); }, [tab]);
  useEffect(() => { if (tab === "assignments" && !assignments) teacherApi.sectionAssignments(section.id).then(setAssignments); }, [tab]);

  const TABS = [
    { id: "roster", label: "Students", icon: Users },
    { id: "analytics", label: "Insights", icon: BarChart3 },
    { id: "assignments", label: "Assignments", icon: ClipboardList },
  ];

  return (
    <div>
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 dark:text-slate-400 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" /> All classes</button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{section.class} · {section.name}</h1>
          <p className="text-slate-500 dark:text-slate-400">{section.students} students</p>
        </div>
        <Button onClick={() => setAssignOpen(true)}><PlusCircle className="h-4 w-4" /> Assign work</Button>
      </div>

      <div className="mt-5 flex gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-white/10 sm:w-fit">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold ${tab === t.id ? "bg-indigo-50 text-indigo-600" : "text-slate-500 dark:text-slate-400"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "roster" && (
          !roster ? <Spinner label="Loading students…" /> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {roster.students.map((s) => (
                <button key={s.id} onClick={() => onStudent(s.id)} className="text-left">
                  <Card className="p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-50 text-lg">🧑‍🎓</div>
                        <div>
                          <p className="font-extrabold text-slate-900 dark:text-white">{s.name}</p>
                          <p className="text-xs text-slate-400">{s.email || s.login_code}</p>
                        </div>
                      </div>
                      <span className={`text-sm font-extrabold ${masteryTone(s.progress.mastery)}`}>{s.progress.mastery}%</span>
                    </div>
                  </Card>
                </button>
              ))}
              {roster.students.length === 0 && <Card className="p-10 text-center text-slate-400 sm:col-span-2">No students in this section yet.</Card>}
            </div>
          )
        )}

        {tab === "analytics" && (!analytics ? <Spinner label="Crunching insights…" /> : <SectionAnalytics a={analytics} onStudent={onStudent} />)}

        {tab === "assignments" && (
          !assignments ? <Spinner label="Loading assignments…" /> : <AssignmentList section={section} list={assignments} />
        )}
      </div>

      {assignOpen && (
        <AssignModal section={section} subjects={subjects}
          onClose={() => setAssignOpen(false)}
          onDone={() => { setAssignOpen(false); setAssignments(null); setTab("assignments"); }} />
      )}
    </div>
  );
}

function SectionAnalytics({ a, onStudent, hideAssignments }) {
  const clk = onStudent ? "cursor-pointer transition hover:ring-1 hover:ring-indigo-300" : "";
  const k = a.kpis || {}, d = a.distribution || {};
  const total = (d.strong || 0) + (d.developing || 0) + (d.needs_help || 0) + (d.no_data || 0) || 1;
  const bars = [
    { label: "On track (≥80%)", v: d.strong || 0, cls: "bg-emerald-400" },
    { label: "Developing (50–79%)", v: d.developing || 0, cls: "bg-indigo-400" },
    { label: "Needs help (<50%)", v: d.needs_help || 0, cls: "bg-rose-400" },
    { label: "No activity yet", v: d.no_data || 0, cls: "bg-slate-300" },
  ];
  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={Brain} label="Avg mastery" value={`${k.avg_mastery ?? 0}%`} tone={masteryTone(k.avg_mastery ?? 0)} />
        <Stat icon={AlertTriangle} label="Needs help" value={k.needs_help ?? 0} tone={(k.needs_help ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"} />
        <Stat icon={CheckCircle2} label="On track" value={k.on_track ?? 0} tone="text-emerald-600" />
        <Stat icon={Activity} label="Active this week" value={`${k.active_7d ?? 0} / ${k.students ?? 0}`} />
      </div>

      {/* AI usage — how much the class is actually using the tutor (engagement) */}
      {a.ai_usage && (
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Activity className="h-4 w-4 text-indigo-500" /> AI tutor usage · last {a.ai_usage.days} days
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <UsageMini label="Active students" value={`${a.ai_usage.active_users}/${a.kpis?.students ?? 0}`} />
            <UsageMini label="AI actions" value={a.ai_usage.calls} />
            <UsageMini label="Credits used" value={a.ai_usage.credits} />
          </div>
        </Card>
      )}

      {/* Recommended focus — the single most impactful thing to reteach */}
      {a.focus && (
        <Card className="flex items-center gap-3 border-l-4 border-indigo-400 p-4">
          <Target className="h-5 w-5 shrink-0 text-indigo-500" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-extrabold text-slate-900 dark:text-white">Reteach next: {a.focus.concept}</span> — the most common gap in this section, affecting {a.focus.count} student{a.focus.count === 1 ? "" : "s"}.
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Mastery distribution */}
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

        {/* Mastery trend */}
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <TrendingUp className="h-4 w-4 text-indigo-500" /> Section mastery — 14 days
          </p>
          <TrendChart data={a.mastery_trend} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Mastery by topic — what to reteach */}
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

        {/* Top performers */}
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

      {/* Students needing attention */}
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

      {/* Per-student table */}
      <Card className="p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">All students</p>
        <div className="mt-3 space-y-1.5">
          {(a.students || []).map((s) => (
            <div key={s.id} onClick={onStudent ? () => onStudent(s.id) : undefined} className={`flex items-center gap-3 rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2 ${clk}`}>
              <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-slate-700 dark:text-slate-200">{s.name}</span>
              <span className="hidden text-xs text-slate-400 sm:inline">{s.open_gaps} gaps</span>
              {"credits_30d" in s && <span className="hidden text-xs text-indigo-400 sm:inline">⚡{s.credits_30d}</span>}
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
        {/* Weakest concepts */}
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

        {/* Assignment completion */}
        {!hideAssignments && (
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
            {(a.assignments || []).length === 0 && <p className="text-sm text-slate-400">No assignments yet — use “Assign work”.</p>}
          </div>
        </Card>
        )}
      </div>
    </div>
  );
}

/* Class detail: section comparison (drill in) + class-wide cohort analytics. */
function ClassView({ cls, onBack, onSection, onStudent }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { teacherApi.classAnalytics(cls.id).then(setData).catch((e) => setErr(apiError(e, "Could not load this class."))); }, [cls.id]);

  if (err) return <div><Back onBack={onBack} /><Card className="p-10 text-center text-rose-500">{err}</Card></div>;
  if (!data) return <div><Back onBack={onBack} /><Spinner label="Crunching class insights…" /></div>;

  return (
    <div>
      <Back onBack={onBack} label="All classes" />
      <h1 className="text-3xl font-extrabold tracking-tight">{data.class?.name || cls.name}</h1>
      <p className="text-slate-500 dark:text-slate-400">{data.kpis?.students ?? 0} students across {(data.sections || []).length} section{(data.sections || []).length === 1 ? "" : "s"} you teach</p>

      {/* Section comparison — click to drill into a section */}
      <Card className="mt-6 p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sections in this class</p>
        <div className="mt-3 space-y-2">
          {(data.sections || []).map((s) => (
            <button key={s.id} onClick={() => onSection({ id: s.id, name: s.name, class: data.class?.name || cls.name, students: s.students })}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2.5 hover:border-indigo-200">
              <span className="w-24 shrink-0 text-left text-sm font-extrabold text-slate-700 dark:text-slate-200">Section {s.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className={`h-full rounded-full ${barTone(s.avg_mastery)}`} style={{ width: `${Math.max(3, s.avg_mastery)}%` }} />
              </div>
              <span className="hidden w-28 shrink-0 text-right text-xs text-slate-400 sm:inline">{s.students} students · {s.at_risk} at risk</span>
              <span className={`w-10 shrink-0 text-right text-sm font-extrabold ${masteryTone(s.avg_mastery)}`}>{s.avg_mastery}%</span>
            </button>
          ))}
          {(data.sections || []).length === 0 && <p className="text-sm text-slate-400">No sections.</p>}
        </div>
      </Card>

      <div className="mt-5">
        <SectionAnalytics a={data} onStudent={onStudent} hideAssignments />
      </div>
    </div>
  );
}

function TrendChart({ data = [] }) {
  return (
    <div className="mt-3 h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" hide /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(dd) => new Date(dd).toLocaleDateString()} formatter={(v) => [`${v}%`, "Mastery"]} />
          <Area type="monotone" dataKey="mastery" stroke="#6366f1" strokeWidth={2.5} fill="url(#tGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function AssignmentList({ section, list }) {
  const [results, setResults] = useState({}); // assignmentId -> results
  const toggle = async (id) => {
    if (results[id]) { setResults((r) => ({ ...r, [id]: null })); return; }
    const data = await teacherApi.assignmentResults(id);
    setResults((r) => ({ ...r, [id]: data }));
  };
  return (
    <div className="space-y-3">
      {list.map((a) => (
        <Card key={a.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-extrabold text-slate-900 dark:text-white">{a.title}</p>
              <p className="text-xs text-slate-400 capitalize">{a.mode} · {a.assessments_count} students · {a.due_at ? `due ${new Date(a.due_at).toLocaleDateString()}` : "no due date"}</p>
            </div>
            <button onClick={() => toggle(a.id)} className="text-sm font-extrabold text-indigo-600 hover:underline">
              {results[a.id] ? "Hide" : "Gradebook"}
            </button>
          </div>
          {results[a.id] && (
            <div className="mt-3 space-y-1.5">
              {results[a.id].results.map((r) => (
                <div key={r.student_id} className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2 text-sm">
                  <span className="font-bold text-slate-700 dark:text-slate-200">{r.student}</span>
                  <span className={`font-extrabold ${r.status === "completed" ? "text-emerald-600" : "text-slate-400"}`}>
                    {r.status === "completed" ? `${r.score}/${r.total}` : "pending"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
      {list.length === 0 && <Card className="p-10 text-center text-slate-400">No assignments yet. Use “Assign work” to push a quiz to this section.</Card>}
    </div>
  );
}

function AssignModal({ section, subjects, onClose, onDone }) {
  const [form, setForm] = useState({ topic_name: "", mode: "fixed", count: 5, subject_id: "", title: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault(); setMsg("");
    if (!form.topic_name.trim()) { setMsg("Enter a topic."); return; }
    setBusy(true);
    try {
      const res = await teacherApi.createAssignment({
        section_id: section.id,
        topic_name: form.topic_name.trim(),
        mode: form.mode,
        count: Number(form.count) || 5,
        title: form.title.trim() || undefined,
        subject_id: form.subject_id || undefined,
      });
      onDone(res);
    } catch (err) { setMsg(apiError(err, "Could not create the assignment.")); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-lg p-6" >
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-500" />
            <h2 className="text-xl font-extrabold">Assign work to {section.class} · {section.name}</h2>
          </div>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <L label="Topic">
              <input value={form.topic_name} onChange={(e) => setForm((f) => ({ ...f, topic_name: e.target.value }))} placeholder="e.g. Quadratic Equations" className={inputCls} />
            </L>
            <L label="Title (optional)">
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Defaults to the topic name" className={inputCls} />
            </L>
            <div className="grid grid-cols-2 gap-3">
              <L label="Questions">
                <input type="number" min={1} max={20} value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))} className={inputCls} />
              </L>
              {(subjects || []).length > 0 && (
                <L label="Subject (optional)">
                  <select value={form.subject_id} onChange={(e) => setForm((f) => ({ ...f, subject_id: e.target.value }))} className={inputCls}>
                    <option value="">Auto</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </L>
              )}
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</span>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { id: "fixed", label: "Same for all", desc: "Identical quiz — comparable, gradebook-style" },
                  { id: "personalized", label: "Personalized", desc: "Each student’s own gaps" },
                ].map((o) => (
                  <button type="button" key={o.id} onClick={() => setForm((f) => ({ ...f, mode: o.id }))}
                    className={`rounded-xl border p-3 text-left transition-all ${form.mode === o.id ? "border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500" : "border-slate-200 dark:border-white/10"}`}>
                    <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{o.label}</span>
                    <span className="block text-[11px] text-slate-400">{o.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            {msg && <p className="text-sm font-semibold text-rose-600">{msg}</p>}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>{busy ? "Generating…" : "Assign to section"}</Button>
              <button type="button" onClick={onClose} className="text-sm font-extrabold text-slate-500 dark:text-slate-400 hover:text-slate-700">Cancel</button>
            </div>
            {busy && form.mode === "personalized" && <p className="text-xs text-slate-400">Personalized quizzes are generated per student — this can take a moment.</p>}
          </form>
        </div>
      </Card>
    </div>
  );
}

function StudentReport({ studentId, onBack }) {
  const [report, setReport] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { teacherApi.studentReport(studentId).then(setReport).catch((e) => setErr(apiError(e, "Could not load this student."))); }, [studentId]);

  if (err) return <div><Back onBack={onBack} /><Card className="p-10 text-center text-rose-500">{err}</Card></div>;
  if (!report) return <div><Back onBack={onBack} /><Spinner label="Loading report…" /></div>;
  const p = report.progress;
  return (
    <div>
      <Back onBack={onBack} />
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
            {report.gaps.map((g) => (
              <div key={g.id} className="flex items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3">
                <div><p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{g.concept}</p><p className="text-xs text-slate-400">{g.topic_name}</p></div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${sevCls(g.severity)}`}>{g.severity}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent assessments</p>
          <div className="mt-3 space-y-2">
            {report.recent_assessments.length === 0 && <p className="text-sm text-slate-400">No assessments yet.</p>}
            {report.recent_assessments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3">
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{a.topic_name}</p>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-extrabold text-indigo-600">{a.score}/{a.total}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

const Back = ({ onBack, label = "Back" }) => (
  <button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 dark:text-slate-400 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" /> {label}</button>
);

const inputCls = "w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200";
const L = ({ label, children }) => (
  <label className="block"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>{children}</label>
);
const Stat = ({ icon: Icon, label, value, tone = "text-slate-900 dark:text-white" }) => (
  <Card className="p-4"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" /></div>
    <p className={`mt-3 text-2xl font-extrabold ${tone}`}>{value}</p><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p></Card>
);
const UsageMini = ({ label, value }) => (
  <div className="rounded-2xl bg-slate-50 dark:bg-white/5 py-2.5"><p className="text-xl font-extrabold text-slate-900 dark:text-white">{value}</p><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p></div>
);
const masteryTone = (m) => m >= 80 ? "text-emerald-600" : m >= 50 ? "text-indigo-600" : m > 0 ? "text-rose-500" : "text-slate-400";
const barTone = (m) => m >= 80 ? "bg-emerald-400" : m >= 50 ? "bg-indigo-400" : "bg-rose-400";
const sevCls = (s) => ({ high: "bg-rose-100 text-rose-600", medium: "bg-amber-100 text-amber-600", low: "bg-emerald-100 text-emerald-600" }[s] || "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400");
