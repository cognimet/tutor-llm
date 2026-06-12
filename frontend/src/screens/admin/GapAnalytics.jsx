import React, { useEffect, useState } from "react";
import { Card, Spinner } from "../../ui/components.jsx";
import { adminGapApi } from "../../api/endpoints.js";
import { AlertTriangle, CheckCircle2, TrendingDown, Activity, Brain } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
} from "recharts";

/**
 * Admin · gap analytics — the content-quality signal. Where the cohort is
 * struggling (most-failed concepts), whether gaps are being closed (created
 * vs resolved), which students need attention, and the misconceptions the
 * tutor keeps catching live in chat.
 */
export default function GapAnalytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setData(null);
    adminGapApi.overview(days).then(setData).catch(() => setErr("Couldn't load gap analytics."));
  }, [days]);

  if (err) return <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{err}</p>;
  if (!data) return <Spinner label="Crunching gap analytics…" />;

  const t = data.totals;
  const sev = data.by_severity;
  const sevColors = { high: "#f43f5e", medium: "#f59e0b", low: "#10b981" };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Gap analytics</h1>
          <p className="text-slate-500 dark:text-slate-400">Where students are struggling — and whether the loop is closing those gaps.</p>
        </div>
        <div className="flex gap-1 rounded-2xl bg-white/70 dark:bg-slate-800/60 p-1 ring-1 ring-slate-200 dark:ring-white/10">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-xl px-3 py-1.5 text-sm font-extrabold ${days === d ? "bg-indigo-500 text-white" : "text-slate-500 dark:text-slate-400"}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Headline tiles */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Tile icon={AlertTriangle} tint="rose" label="Open gaps" value={t.open_gaps} />
        <Tile icon={CheckCircle2} tint="emerald" label="Resolved (all time)" value={t.resolved_total} />
        <Tile icon={TrendingDown} tint="amber" label={`New (${days}d)`} value={t.created_in_period} />
        <Tile icon={Activity} tint="sky" label={`Closed (${days}d)`} value={t.resolved_in_period} />
        <Tile icon={Brain} tint="indigo" label="Close rate" value={t.resolution_rate != null ? `${t.resolution_rate}%` : "—"} />
      </div>

      {/* Severity mix + created-vs-resolved trend */}
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Open gaps by severity</p>
          <div className="mt-4 space-y-3">
            {["high", "medium", "low"].map((s) => {
              const total = Math.max(1, sev.high + sev.medium + sev.low);
              return (
                <div key={s}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-extrabold capitalize text-slate-600 dark:text-slate-300">{s}</span>
                    <span className="font-extrabold" style={{ color: sevColors[s] }}>{sev[s]}</span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${(sev[s] / total) * 100}%`, background: sevColors[s] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Created vs resolved</p>
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} hide />
                <Tooltip /><Legend />
                <Line type="monotone" dataKey="created" name="New gaps" stroke="#f43f5e" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Most-failed concepts */}
      <Card className="mt-6 p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Most-failed concepts (content weak spots)</p>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.top_concepts} layout="vertical" margin={{ left: 30 }}>
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis type="category" dataKey="concept" width={210} tick={{ fontSize: 11, fontWeight: 700 }} />
              <Tooltip formatter={(v, n) => [v, n === "open" ? "Still open" : "Total"]}
                labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.topic_name ?? ""}`} />
              <Bar dataKey="total" name="Total" fill="#c7d2fe" radius={[0, 6, 6, 0]} />
              <Bar dataKey="open" name="Still open" fill="#6366f1" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* Students at risk */}
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Students needing attention</p>
          <div className="mt-3 space-y-2">
            {data.students_at_risk.length === 0 && <p className="text-sm text-slate-400">No open gaps anywhere — excellent.</p>}
            {data.students_at_risk.map((s, i) => (
              <div key={s.user?.id ?? i} className="flex items-center justify-between rounded-2xl border border-slate-100 dark:border-white/10 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{s.user?.name || "Unknown"}</p>
                  <p className="truncate text-xs text-slate-400">
                    {s.weakest_concept ? `Weakest: ${s.weakest_concept.concept} (${s.weakest_concept.score}%)` : s.user?.email}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-extrabold text-rose-600">{s.open_gaps} gaps</span>
                  {s.high_severity > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-extrabold text-rose-700">{s.high_severity} high</span>}
                  {s.open_misconceptions > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-extrabold text-amber-600">{s.open_misconceptions} misc.</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Cohort mastery by topic */}
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cohort mastery by topic (weakest first)</p>
          <div className="mt-3 space-y-3">
            {data.mastery_by_topic.length === 0 && <p className="text-sm text-slate-400">No mastery data yet — it builds as students chat and take checks.</p>}
            {data.mastery_by_topic.map((m) => (
              <div key={m.topic_name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="min-w-0 flex-1 truncate font-extrabold text-slate-700 dark:text-slate-200">{m.topic_name}</span>
                  <span className="ml-2 text-xs font-bold text-slate-400">{m.students} students</span>
                  <span className={`ml-2 font-extrabold ${m.avg_mastery >= 80 ? "text-emerald-600" : m.avg_mastery >= 50 ? "text-indigo-600" : "text-rose-500"}`}>
                    {m.avg_mastery}%
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div className={`h-full rounded-full ${m.avg_mastery >= 80 ? "bg-emerald-400" : m.avg_mastery >= 50 ? "bg-indigo-400" : "bg-rose-400"}`}
                    style={{ width: `${Math.max(4, m.avg_mastery)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recurring misconceptions */}
      <Card className="mt-6 p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Misconceptions the tutor keeps catching</p>
        <div className="mt-3 space-y-2">
          {data.misconceptions.length === 0 && <p className="text-sm text-slate-400">None recorded yet — they appear as the tutor spots them in chat.</p>}
          {data.misconceptions.map((m, i) => (
            <div key={i} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 dark:border-white/10 p-3">
              <div className="min-w-0">
                <p className="text-sm font-bold leading-snug text-slate-700 dark:text-slate-200">{m.description}</p>
                <p className="text-xs text-slate-400">{m.topic_name}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <span className="rounded-full bg-slate-100 dark:bg-white/10 px-2 py-0.5 text-xs font-extrabold text-slate-500 dark:text-slate-400">{m.count}×</span>
                {Number(m.open) > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-extrabold text-amber-600">{m.open} open</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function Tile({ icon: Icon, tint, label, value }) {
  return (
    <Card className="p-4">
      <div className={`grid h-10 w-10 place-items-center rounded-2xl bg-${tint}-50 text-${tint}-600`}><Icon className="h-5 w-5" /></div>
      <p className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </Card>
  );
}
