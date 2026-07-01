import React, { useEffect, useState } from "react";
import { Spinner } from "../../ui/components.jsx";
import {
  Users, UserCheck, ClipboardCheck, Activity, ShieldCheck, Download,
} from "lucide-react";
import {
  Scorecard, DayToggle, Hero, TrendLine, GapBars, Panel, Empty, Band, downloadCsv,
} from "../../ui/analytics/AnalyticsKit.jsx";
import { adminAnalyticsApi } from "../../api/endpoints.js";

const SEG_COLORS = { excelling: "#10b981", on_track: "#84cc16", at_risk: "#f59e0b", critical: "#f43f5e" };
const SEG_LABEL = { excelling: "Excelling", on_track: "On track", at_risk: "At risk", critical: "Critical" };

/**
 * Admin · system-wide analytics. Segmentation, gap trends, integrity monitoring,
 * completion & engagement, plus CSV export — from /admin/analytics.
 */
export default function SystemAnalytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    setData(null); setErr("");
    adminAnalyticsApi.overview(days)
      .then((d) => on && setData(d))
      .catch(() => on && setErr("Couldn't load system analytics."));
    return () => { on = false; };
  }, [days]);

  if (err) return <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{err}</p>;
  if (!data) return <Spinner label="Aggregating system analytics…" />;

  const t = data.totals || {};
  const seg = data.segmentation || {};
  const segData = Object.keys(SEG_LABEL).map((k) => ({ label: SEG_LABEL[k], value: seg[k] || 0, key: k }));
  const topGaps = (data.top_gap_concepts || []).map((g) => ({ concept: g.concept || "General", total: Number(g.total) }));

  return (
    <>
      <Hero icon={Activity} title="System analytics"
        subtitle="Cohort performance, integrity and engagement across all students."
        right={
          <>
            <button onClick={() => downloadCsv(data.export_rows, `analytics-${days}d.csv`)}
              className="flex items-center gap-1.5 rounded-2xl bg-white/20 px-3 py-2 text-sm font-extrabold text-white hover:bg-white/30">
              <Download className="h-4 w-4" /> Export CSV
            </button>
            <DayToggle days={days} setDays={setDays} onGradient />
          </>
        } />

      {/* Headline */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Scorecard icon={Users} tint="indigo" label="Students" value={t.students} />
        <Scorecard icon={UserCheck} tint="sky" label="Active" value={t.active_students} />
        <Scorecard icon={ClipboardCheck} tint="emerald" label="Assessments" value={t.assessments} />
        <Scorecard icon={Activity} tint="amber" label="Completion" value={t.completion_rate} suffix="%" />
        <Scorecard icon={Activity} tint="emerald" label="Avg engagement" value={t.avg_engagement} />
        <Scorecard icon={ShieldCheck} tint="rose" label="Avg integrity" value={t.avg_integrity} />
      </div>

      {/* Segmentation + top gap concepts */}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Panel title="Performance segmentation" subtitle="Students bucketed by recent accuracy">
          <div className="flex gap-3">
            {segData.map((s) => (
              <div key={s.key} className="flex-1 rounded-xl p-3 text-white" style={{ background: SEG_COLORS[s.key] }}>
                <p className="text-2xl font-extrabold">{s.value}</p>
                <p className="text-[11px] font-bold uppercase tracking-wider opacity-90">{s.label}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Most-missed concepts" subtitle="Cohort-wide weak spots">
          {topGaps.length ? <GapBars data={topGaps} xKey="concept" barKey="total" color="#f43f5e" /> : <Empty>No gaps recorded.</Empty>}
        </Panel>
      </div>

      {/* Gap trend + completion trend */}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Panel title="Gap created vs resolved" subtitle="Is the loop closing?">
          <TrendLine data={data.gap_trends || []} series={[
            { key: "created", label: "Created", color: "#f43f5e" },
            { key: "resolved", label: "Resolved", color: "#10b981" },
          ]} />
        </Panel>
        <Panel title="Completion & engagement" subtitle="Daily completion rate + active users">
          <TrendLine data={data.completion_trend || []} series={[{ key: "rate", label: "Completion %", color: "#6366f1" }]} yMax={100} />
        </Panel>
      </div>

      {/* Integrity monitoring */}
      <div className="mt-6">
        <Panel title="Integrity monitoring" subtitle="Most tab-switching during assessments — review for authenticity">
          {(data.integrity_report || []).length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  <tr><th className="py-2">Student</th><th>Grade</th><th>Tab switches</th><th>Integrity</th></tr>
                </thead>
                <tbody>
                  {data.integrity_report.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-white/10">
                      <td className="py-2 font-bold text-slate-700 dark:text-slate-200">{r.user?.name ?? "—"}</td>
                      <td className="text-slate-500">{r.user?.grade ?? "—"}</td>
                      <td className="font-extrabold text-rose-500">{r.tab_switches}</td>
                      <td><Band value={r.integrity_score >= 80 ? "clean" : r.integrity_score >= 60 ? "watch" : "review"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No integrity flags in this window. 🎉</Empty>}
        </Panel>
      </div>
    </>
  );
}
