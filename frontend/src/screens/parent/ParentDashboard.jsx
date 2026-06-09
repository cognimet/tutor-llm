import React, { useEffect, useState } from "react";
import { Backdrop, AppHeader, Card, Spinner, Button } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { parentApi } from "../../api/endpoints.js";
import { Brain, Target, Flame, ListChecks, ArrowLeft, UserPlus, ChevronRight } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

export default function ParentDashboard() {
  const { user, logout } = useAuth();
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [linking, setLinking] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => { setChildren(await parentApi.children()); };

  useEffect(() => { (async () => { try { await load(); } finally { setLoading(false); } })(); }, []);

  const openReport = async (child) => setReport(await parentApi.report(child.id));

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
        {loading ? <Spinner label="Loading your children…" /> : report ? (
          <ChildReport report={report} onBack={() => setReport(null)} />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Family dashboard</h1>
                <p className="text-slate-500">Track how your children are learning.</p>
              </div>
              <Button variant="soft" onClick={() => setLinking((v) => !v)}><UserPlus className="h-4 w-4" /> Link child</Button>
            </div>

            {linking && (
              <Card className="mt-5 p-5">
                <form onSubmit={link} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Student email</span>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="child@example.com"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200" />
                  </label>
                  <Button type="submit">Link account</Button>
                </form>
                {msg && <p className="mt-2 text-sm font-semibold text-rose-600">{msg}</p>}
              </Card>
            )}

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {children.map((c) => (
                <button key={c.id} onClick={() => openReport(c)} className="text-left">
                  <Card className="p-6 transition-all hover:-translate-y-1 hover:shadow-xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-2xl">🧑‍🎓</div>
                        <div><p className="text-lg font-extrabold text-slate-900">{c.name}</p><p className="text-sm text-slate-400">Class {c.grade} · {String(c.board).toUpperCase()}</p></div>
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
        )}
      </div>
    </div>
  );
}

function ChildReport({ report, onBack }) {
  const p = report.progress;
  return (
    <div>
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" /> All children</button>
      <h1 className="text-3xl font-extrabold tracking-tight">{report.child.name}</h1>
      <p className="text-slate-500">Class {report.child.grade} · {String(report.child.board).toUpperCase()}</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={Brain} label="Mastery" value={`${p.mastery}%`} />
        <Stat icon={Target} label="Accuracy" value={`${p.accuracy}%`} />
        <Stat icon={ListChecks} label="Open gaps" value={p.open_gaps} />
        <Stat icon={Flame} label="Streak" value={`${p.streak_days}d`} />
      </div>

      <Card className="mt-6 p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Mastery over time</p>
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

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Open knowledge gaps</p>
          <div className="mt-3 space-y-2">
            {report.gaps.length === 0 && <p className="text-sm text-slate-400">No open gaps — great work!</p>}
            {report.gaps.map((g) => (
              <div key={g.id} className="flex items-center justify-between rounded-2xl border border-slate-100 p-3">
                <div><p className="text-sm font-extrabold text-slate-800">{g.concept}</p><p className="text-xs text-slate-400">{g.topic_name}</p></div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${sevCls(g.severity)}`}>{g.severity}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Recent assessments</p>
          <div className="mt-3 space-y-2">
            {report.recent_assessments.length === 0 && <p className="text-sm text-slate-400">No assessments yet.</p>}
            {report.recent_assessments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-2xl border border-slate-100 p-3">
                <p className="text-sm font-extrabold text-slate-800">{a.topic_name}</p>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-extrabold text-indigo-600">{a.score}/{a.total}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

const Mini = ({ label, value }) => (
  <div className="rounded-2xl bg-slate-50 py-2"><p className="text-lg font-extrabold text-slate-900">{value}</p><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p></div>
);
const Stat = ({ icon: Icon, label, value }) => (
  <Card className="p-4"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" /></div>
    <p className="mt-3 text-2xl font-extrabold text-slate-900">{value}</p><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p></Card>
);
const sevCls = (s) => ({ high: "bg-rose-100 text-rose-600", medium: "bg-amber-100 text-amber-600", low: "bg-emerald-100 text-emerald-600" }[s] || "bg-slate-100 text-slate-500");
