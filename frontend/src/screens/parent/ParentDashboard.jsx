import React, { useEffect, useState } from "react";
import { Backdrop, AppHeader, Card, Spinner, Button } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { parentApi, usageApi } from "../../api/endpoints.js";
import {
  Brain, Target, Flame, ListChecks, ArrowLeft, UserPlus, ChevronRight,
  Zap, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";

export default function ParentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => { setChildren(await parentApi.children()); };

  useEffect(() => { (async () => { try { await load(); } finally { setLoading(false); } })(); }, []);

  const link = async (e) => {
    e.preventDefault(); setMsg("");
    try { await parentApi.linkChild(email); setEmail(""); setLinking(false); await load(); }
    catch (err) { setMsg(err.response?.data?.message || "Could not link that account."); }
  };

  return (
    <div className="min-h-screen">
      <Backdrop />
      <AppHeader user={user} onLogout={logout} />
      <div className="mx-auto max-w-6xl px-5 py-8">
        <Routes>
          <Route index element={loading ? <Spinner label="Loading your children…" /> : (
            <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Family dashboard</h1>
                <p className="text-slate-500 dark:text-slate-400">Track how your children are learning.</p>
              </div>
              <Button variant="soft" onClick={() => setLinking((v) => !v)}><UserPlus className="h-4 w-4" /> Link child</Button>
            </div>

            {linking && (
              <Card className="mt-5 p-5">
                <form onSubmit={link} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Student email</span>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="child@example.com"
                      className="w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200" />
                  </label>
                  <Button type="submit">Link account</Button>
                </form>
                {msg && <p className="mt-2 text-sm font-semibold text-rose-600">{msg}</p>}
              </Card>
            )}

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {children.map((c) => (
                <button key={c.id} onClick={() => navigate(`/child/${c.id}`)} className="text-left">
                  <Card className="p-6 transition-all hover:-translate-y-1 hover:shadow-xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-2xl">🧑‍🎓</div>
                        <div><p className="text-lg font-extrabold text-slate-900 dark:text-white">{c.name}</p><p className="text-sm text-slate-400">Class {c.grade} · {String(c.board).toUpperCase()}</p></div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-300" />
                    </div>
                    <div className="mt-5 grid grid-cols-4 gap-2 text-center">
                      <Mini label="Mastery" value={`${c.progress.mastery}%`} />
                      <Mini label="Accuracy" value={`${c.progress.accuracy}%`} />
                      <Mini label="Gaps" value={c.progress.open_gaps} />
                      <Mini label="Streak" value={c.progress.streak_days} />
                    </div>
                  </Card>
                </button>
              ))}
              {children.length === 0 && (
                <Card className="p-10 text-center text-slate-400 sm:col-span-2">
                  No children linked yet. Use “Link child” with your child’s student email.
                </Card>
              )}
            </div>
            </>
          )} />
          <Route path="child/:id" element={<ChildReportRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

// Loads one child's report from the URL (/child/:id) so it survives a reload.
function ChildReportRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    try {
      const [rep, gaps, usage] = await Promise.all([
        parentApi.report(id),
        parentApi.gaps(id).catch(() => null),
        usageApi.child(id).catch(() => null),
      ]);
      setReport({ ...rep, gapsDash: gaps, usage });
    } catch { navigate("/", { replace: true }); }
    finally { setLoading(false); }
  })(); }, [id]);

  if (loading) return <Spinner label="Loading report…" />;
  if (!report) return <Navigate to="/" replace />;
  return <ChildReport report={report} onBack={() => navigate("/")} />;
}

function ChildReport({ report, onBack }) {
  const p = report.progress;
  return (
    <div>
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 dark:text-slate-400 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" /> All children</button>
      <h1 className="text-3xl font-extrabold tracking-tight">{report.child.name}</h1>
      <p className="text-slate-500 dark:text-slate-400">Class {report.child.grade} · {String(report.child.board).toUpperCase()}</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={Brain} label="Mastery" value={`${p.mastery}%`} />
        <Stat icon={Target} label="Accuracy" value={`${p.accuracy}%`} />
        <Stat icon={ListChecks} label="Open gaps" value={p.open_gaps} />
        <Stat icon={Flame} label="Streak" value={`${p.streak_days}d`} />
      </div>

      <Card className="mt-6 p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mastery over time</p>
        <div className="mt-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={p.trend}>
              <XAxis dataKey="day" hide /><YAxis domain={[0, 100]} hide />
              <Tooltip />
              <Line type="monotone" dataKey="mastery" stroke="#6366f1" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* AI usage — credits only, never raw tokens */}
      {report.usage?.summary && (
        <Card className="mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Zap className="h-4 w-4 text-amber-500" /> AI usage (credits)
            </p>
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-600">
              {report.usage.summary.plan?.name || "Free"} plan
            </span>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <UsageBar label="Today" used={report.usage.summary.daily?.used} limit={report.usage.summary.daily?.limit} />
            <UsageBar label="This month" used={report.usage.summary.monthly?.used} limit={report.usage.summary.monthly?.limit} />
          </div>
          {(report.usage.last_7_days || []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {report.usage.last_7_days.map((a) => (
                <span key={a.action_type} className="rounded-full bg-slate-50 dark:bg-white/5 px-3 py-1.5 text-xs font-extrabold capitalize text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-white/10">
                  {a.action_type}: {Number(a.credits).toLocaleString()} credits
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Advanced gap analysis */}
      {report.gapsDash && <GapDashboard dash={report.gapsDash} />}

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

function UsageBar({ label, used = 0, limit = 0 }) {
  const pct = Math.min(100, (Number(used) / Math.max(1, Number(limit))) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-extrabold text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-extrabold text-slate-800 dark:text-slate-100">{Number(used).toLocaleString()} / {Number(limit).toLocaleString()}</span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <div className={`h-full rounded-full transition-all ${pct > 85 ? "bg-rose-400" : pct > 60 ? "bg-amber-400" : "bg-emerald-400"}`}
          style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
    </div>
  );
}

function GapDashboard({ dash }) {
  const s = dash.summary || {};
  const sevColors = { high: "#f43f5e", medium: "#f59e0b", low: "#10b981" };
  return (
    <Card className="mt-6 p-5">
      <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <AlertTriangle className="h-4 w-4 text-amber-500" /> Gap analysis
      </p>

      {/* Severity summary */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MiniStat label="Open gaps" value={s.open ?? 0} tone="text-slate-900 dark:text-white" />
        <MiniStat label="High" value={s.high ?? 0} tone="text-rose-600" />
        <MiniStat label="Medium" value={s.medium ?? 0} tone="text-amber-600" />
        <MiniStat label="Low" value={s.low ?? 0} tone="text-emerald-600" />
        <MiniStat label="Closed (30d)" value={s.resolved_last_30d ?? 0} tone="text-indigo-600" />
      </div>

      {/* New vs closed trend */}
      <div className="mt-4 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dash.trend}>
            <XAxis dataKey="day" hide /><YAxis allowDecimals={false} hide />
            <Tooltip /><Legend />
            <Line type="monotone" dataKey="created" name="New gaps" stroke="#f43f5e" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="resolved" name="Closed" stroke="#10b981" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {/* Mastery by topic with weakest concepts */}
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Mastery by topic</p>
          <div className="mt-2 space-y-3">
            {(dash.mastery_by_topic || []).length === 0 && (
              <p className="text-sm text-slate-400">Builds up as your child chats and takes quick checks.</p>
            )}
            {(dash.mastery_by_topic || []).map((m) => (
              <div key={m.topic_name} className="rounded-2xl border border-slate-100 dark:border-white/10 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="min-w-0 flex-1 truncate font-extrabold text-slate-700 dark:text-slate-200">{m.topic_name}</span>
                  <span className={`font-extrabold ${m.avg_mastery >= 80 ? "text-emerald-600" : m.avg_mastery >= 50 ? "text-indigo-600" : "text-rose-500"}`}>{m.avg_mastery}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div className={`h-full rounded-full ${m.avg_mastery >= 80 ? "bg-emerald-400" : m.avg_mastery >= 50 ? "bg-indigo-400" : "bg-rose-400"}`}
                    style={{ width: `${Math.max(4, m.avg_mastery)}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(m.concepts || []).map((c) => (
                    <span key={c.concept} className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${c.passes ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400"}`}>
                      {c.concept} · {c.score}%
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Misconceptions, open -> fixed */}
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Misconceptions the tutor caught</p>
          <div className="mt-2 space-y-2">
            {(dash.misconceptions || []).length === 0 && (
              <p className="text-sm text-slate-400">None spotted — they appear here as the tutor catches them live.</p>
            )}
            {(dash.misconceptions || []).map((m) => (
              <div key={m.id} className={`flex items-start gap-2 rounded-2xl p-3 ${m.status === "open" ? "bg-amber-50" : "bg-emerald-50/70"}`}>
                {m.status === "open"
                  ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
                <div className="min-w-0">
                  <p className={`text-sm font-bold leading-snug ${m.status === "open" ? "text-amber-800" : "text-emerald-700 line-through decoration-emerald-300"}`}>
                    {m.description}
                  </p>
                  <p className="text-xs text-slate-400">{m.topic_name}</p>
                </div>
              </div>
            ))}
          </div>

          {(dash.open_gaps || []).some((g) => g.recommendation) && (
            <>
              <p className="mt-4 text-xs font-extrabold uppercase tracking-wide text-slate-400">What the tutor recommends</p>
              <div className="mt-2 space-y-1.5">
                {dash.open_gaps.filter((g) => g.recommendation).slice(0, 4).map((g) => (
                  <p key={g.id} className="rounded-2xl bg-indigo-50/60 px-3 py-2 text-xs font-bold leading-snug text-indigo-800">
                    <span className="font-extrabold">{g.concept}:</span> {g.recommendation}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

const MiniStat = ({ label, value, tone }) => (
  <div className="rounded-2xl bg-slate-50 dark:bg-white/5 px-3 py-2 text-center">
    <p className={`text-xl font-extrabold ${tone}`}>{value}</p>
    <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
  </div>
);

const Mini = ({ label, value }) => (
  <div className="rounded-2xl bg-slate-50 dark:bg-white/5 py-2"><p className="text-lg font-extrabold text-slate-900 dark:text-white">{value}</p><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p></div>
);
const Stat = ({ icon: Icon, label, value }) => (
  <Card className="p-4"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" /></div>
    <p className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-white">{value}</p><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p></Card>
);
const sevCls = (s) => ({ high: "bg-rose-100 text-rose-600", medium: "bg-amber-100 text-amber-600", low: "bg-emerald-100 text-emerald-600" }[s] || "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400");
