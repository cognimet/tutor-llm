import React from "react";
import {
  Target, Activity, ShieldCheck, Brain, Clock, AlertTriangle, Timer, CalendarDays, BookOpenCheck,
  Flame, TrendingUp, TrendingDown, Minus, Layers,
} from "lucide-react";
import {
  Scorecard, Gauge, Band, TrendLine, GapBars, Heatmap, RecoList, SeverityMix, Panel, Empty,
} from "./AnalyticsKit.jsx";

// Minutes → "2h 15m" / "45m".
function fmtMin(m) {
  if (m == null) return "—";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// 14 → "2 PM".
function fmtHour(h) {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

// Delta pill: up (good) green, down red, flat grey. `unit` appended to value.
function DeltaPill({ delta, unit = "" }) {
  if (delta == null) return <span className="text-xs font-bold text-slate-400">—</span>;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const cls = delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-500" : "text-slate-400";
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-extrabold ${cls}`}>
      <Icon className="h-4 w-4" />{delta > 0 ? "+" : ""}{delta}{unit}
    </span>
  );
}

/**
 * Renders one learner's analytics payload (the shape returned by
 * /me/analytics and /parent/children/{id}/analytics). Shared by the student
 * "User Dashboard" and the parent "Child Dashboard"; `audience` switches copy
 * and shows parent interventions.
 */
// Plain-language, jargon-free takeaways built from the numbers — the friendly
// "what does this mean?" layer above the charts.
function buildSummary(data, isParent) {
  const h = data.headline || {};
  const att = data.attention || {};
  const who = isParent ? "They" : "You";
  const whoLower = isParent ? "they" : "you";
  const out = [];

  if (h.accuracy != null) {
    const mood = h.accuracy >= 80 ? "🌟 Excellent" : h.accuracy >= 60 ? "👍 Solid" : "💪 Keep going";
    out.push(`${mood} — ${h.accuracy}% correct across ${h.questions || 0} questions.`);
  } else {
    out.push(`📝 No questions answered yet — take an assessment to unlock insights.`);
  }
  const str = (data.strengths || [])[0];
  if (str) out.push(`🏆 Strongest area: ${str.concept} (${str.score}% mastery).`);
  const weak = (data.weaknesses || [])[0];
  if (weak) out.push(`🎯 Best next focus: ${weak.concept} (${weak.score}% mastery).`);
  if (h.total_min > 0) {
    const hrs = h.total_min < 60 ? `${h.total_min} min` : `${(h.total_min / 60).toFixed(1)} hrs`;
    out.push(`⏱️ ${hrs} studied across ${h.active_days || 1} day${(h.active_days || 1) > 1 ? "s" : ""}.`);
  }
  if (h.open_gaps > 0) out.push(`🧩 ${h.open_gaps} open gap${h.open_gaps > 1 ? "s" : ""} to close.`);
  if ((att.tab_switches ?? 0) >= 5) out.push(`👀 ${who} switched tabs ${att.tab_switches} times — ${whoLower} focus better in one window.`);
  else if (att.score != null && att.score >= 80) out.push(`🔒 Great focus — few distractions while studying.`);
  return out;
}

export default function AnalyticsView({ data, audience = "student" }) {
  const h = data.headline || {};
  const att = data.attention || {};
  const integ = data.integrity || {};
  const gaps = data.gap_analysis || {};
  const study = data.study_time || {};
  const subjects = data.subjects || [];
  const patterns = data.patterns || {};
  const bench = data.benchmark || {};
  const isParent = audience === "parent";
  const summary = buildSummary(data, isParent);

  const masteryCells = [
    ...(data.strengths || []).map((s) => ({ label: s.concept, value: s.score })),
    ...(data.weaknesses || []).map((s) => ({ label: s.concept, value: s.score })),
  ];

  return (
    <div className="space-y-6">
      {/* Friendly plain-language summary */}
      <Panel title={isParent ? "In a nutshell" : "Your snapshot"} subtitle="What the numbers mean">
        <ul className="grid gap-2 sm:grid-cols-2">
          {summary.map((s, i) => (
            <li key={i} className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 dark:bg-white/5 dark:text-slate-300">{s}</li>
          ))}
        </ul>
      </Panel>

      {/* Headline scorecards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Scorecard icon={Target} tint="indigo" label="Accuracy" value={h.accuracy} suffix="%" sub={`${h.questions ?? 0} questions`} />
        <Scorecard icon={Brain} tint="sky" label="Mastery" value={h.mastery_avg} suffix="%" />
        <Scorecard icon={Activity} tint="emerald" label="Engagement" value={h.engagement_score} />
        <Scorecard icon={ShieldCheck} tint="amber" label="Integrity" value={h.integrity_score} />
        <Scorecard icon={AlertTriangle} tint="rose" label="Open gaps" value={h.open_gaps} />
        <Scorecard icon={Clock} tint="slate" label="Avg / question" value={data.time_insights?.avg_per_question_s} suffix="s" />
      </div>

      {/* Personal benchmark — this period vs last */}
      <Panel title="Progress vs last period" subtitle="Compared to the previous window — your own benchmark">
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Accuracy</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{bench.accuracy?.current ?? "—"}%</span>
              <DeltaPill delta={bench.accuracy?.delta} unit="%" />
            </div>
            <p className="text-xs font-semibold text-slate-400">was {bench.accuracy?.previous ?? "—"}%</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Study time</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{fmtMin(bench.study_minutes?.current)}</span>
              <DeltaPill delta={bench.study_minutes?.delta} unit="m" />
            </div>
            <p className="text-xs font-semibold text-slate-400">was {fmtMin(bench.study_minutes?.previous)}</p>
          </div>
        </div>
      </Panel>

      {/* Attention + integrity gauges */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Attention & engagement" subtitle={isParent ? "How focused they stay while studying" : "How focused you stay while studying"}>
          <div className="flex items-center justify-around">
            <Gauge value={att.score} label="Engagement" />
            <div className="space-y-1 text-sm font-semibold text-slate-500">
              <p>Tab switches: <b className="text-slate-700 dark:text-slate-200">{att.tab_switches ?? 0}</b></p>
              <p>Focus-away: <b className="text-slate-700 dark:text-slate-200">{att.focus_away_s ?? 0}s</b></p>
              <p>Completion: <b className="text-slate-700 dark:text-slate-200">{att.completion_rate ?? "—"}%</b></p>
              <p>Drop-offs: <b className="text-slate-700 dark:text-slate-200">{att.drop_offs ?? 0}</b></p>
              <Band value={att.band} />
            </div>
          </div>
        </Panel>

        <Panel title="Assessment integrity" subtitle="Authenticity from focus patterns">
          <div className="flex items-center justify-around">
            <Gauge value={integ.score} label="Integrity" />
            <div className="space-y-1 text-sm font-semibold text-slate-500">
              <p>Switches / test: <b className="text-slate-700 dark:text-slate-200">{integ.per_assessment ?? 0}</b></p>
              <p>Long aways: <b className="text-slate-700 dark:text-slate-200">{integ.long_aways ?? 0}</b></p>
              <Band value={integ.flag} />
            </div>
          </div>
        </Panel>

        <Panel title="Gap severity" subtitle="Open knowledge gaps by urgency">
          <SeverityMix high={gaps.by_severity?.high} medium={gaps.by_severity?.medium} low={gaps.by_severity?.low} />
          <div className="mt-4 space-y-1.5">
            {(gaps.knowledge_gaps || []).slice(0, 5).map((g, i) => (
              <div key={i} className="flex items-center justify-between text-xs font-semibold">
                <span className="truncate text-slate-600 dark:text-slate-300">{g.concept}</span>
                <span className={g.severity === "high" ? "text-rose-500" : g.severity === "medium" ? "text-amber-500" : "text-emerald-500"}>{g.severity}</span>
              </div>
            ))}
            {!(gaps.knowledge_gaps || []).length && <Empty>No open gaps 🎉</Empty>}
          </div>
        </Panel>
      </div>

      {/* Study time — total, focus, per subject */}
      <Panel title="Study time" subtitle={isParent ? "How much time they invest, and where" : "How much time you invest, and where"}>
        <div className="grid gap-4 lg:grid-cols-[repeat(3,minmax(0,220px))_1fr]">
          <Scorecard icon={Clock} tint="indigo" label="Total time" value={fmtMin(study.total_min)} />
          <Scorecard icon={Timer} tint="emerald" label="Focused time" value={fmtMin(study.focus_min)}
            sub={study.focus_pct != null ? `${study.focus_pct}% of total` : undefined} />
          <Scorecard icon={CalendarDays} tint="amber" label="Active days" value={study.active_days ?? 0}
            sub={study.avg_min_day ? `${fmtMin(study.avg_min_day)}/day` : undefined} />
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <BookOpenCheck className="h-4 w-4" /> Time by subject
            </p>
            {(study.by_subject || []).length
              ? <GapBars data={study.by_subject} xKey="label" barKey="minutes" color="#8b5cf6" height={200} />
              : <Empty>No study time logged yet.</Empty>}
          </div>
        </div>
      </Panel>

      {/* Subject-wise breakdown */}
      <Panel title="By subject" subtitle="Performance, effort and quiz volume per subject">
        {subjects.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold uppercase tracking-wider text-slate-400">
                <tr><th className="py-2">Subject</th><th>Accuracy</th><th>Questions</th><th>Study time</th></tr>
              </thead>
              <tbody>
                {subjects.map((s, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-white/10">
                    <td className="py-2 font-bold text-slate-700 dark:text-slate-200">{s.subject}</td>
                    <td>
                      <span className={`font-extrabold ${s.accuracy >= 75 ? "text-emerald-600" : s.accuracy >= 55 ? "text-amber-600" : "text-rose-500"}`}>{s.accuracy}%</span>
                    </td>
                    <td className="text-slate-500">{s.questions}</td>
                    <td className="text-slate-500">{fmtMin(s.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No subject data yet — take a quiz to populate this.</Empty>}
      </Panel>

      {/* Weekly progress + engagement patterns */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Weekly progress" subtitle="Accuracy by week — improving or slipping?">
          {(data.weekly_trend || []).length
            ? <TrendLine data={data.weekly_trend} xKey="week" series={[{ key: "accuracy", label: "Accuracy %", color: "#6366f1" }]} yMax={100} />
            : <Empty>Not enough weeks of data yet.</Empty>}
        </Panel>
        <Panel title="Engagement patterns" subtitle="Consistency, streak and when they study">
          <div className="grid grid-cols-3 gap-3">
            <Scorecard icon={Flame} tint="rose" label="Streak" value={patterns.streak ?? 0} suffix="d" />
            <Scorecard icon={CalendarDays} tint="emerald" label="Consistency" value={patterns.consistency_pct ?? 0} suffix="%" />
            <Scorecard icon={Layers} tint="indigo" label="Sessions" value={patterns.sessions ?? 0} />
          </div>
          <div className="mt-3">
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Peak study hours</p>
            {(patterns.peak_hours || []).length
              ? <div className="flex flex-wrap gap-2">
                  {patterns.peak_hours.map((p, i) => (
                    <span key={i} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-extrabold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">{fmtHour(p.hour)}</span>
                  ))}
                </div>
              : <p className="text-sm font-semibold text-slate-400">Not enough data yet.</p>}
          </div>
        </Panel>
      </div>

      {/* Accuracy trend + improvement across attempts */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Accuracy over time" subtitle="Daily correct-answer rate">
          <TrendLine data={data.accuracy_trend || []} series={[{ key: "accuracy", label: "Accuracy %", color: "#6366f1" }]} yMax={100} />
        </Panel>
        <Panel title="Improvement across attempts" subtitle="Score per completed assessment">
          {(data.attempt_trend || []).length
            ? <TrendLine data={data.attempt_trend} xKey="date" series={[{ key: "score", label: "Score %", color: "#10b981" }]} yMax={100} />
            : <Empty>No completed assessments yet.</Empty>}
        </Panel>
      </div>

      {/* Strengths / weaknesses heatmap + difficulty */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Concept mastery heatmap" subtitle="Strengths (green) → weak spots (red)">
          <Heatmap cells={masteryCells} />
        </Panel>
        <Panel title="Difficulty vs performance" subtitle="Lowest-accuracy concepts first">
          {(data.difficulty || []).length
            ? <GapBars data={data.difficulty} xKey="concept" barKey="accuracy" colorByValue />
            : <Empty>Not enough graded answers yet.</Empty>}
        </Panel>
      </div>

      {/* Recommendations / interventions */}
      <Panel title={isParent ? "Recommended interventions" : "Your action plan"}
        subtitle={isParent ? "Where to help next" : "Highest-impact next steps"}>
        {isParent && (data.interventions || []).length
          ? <RecoList items={data.interventions} />
          : <RecoList items={data.recommendations || []} />}
      </Panel>
    </div>
  );
}
