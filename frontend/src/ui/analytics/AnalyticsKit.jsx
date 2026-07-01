import React from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, RadialBarChart, RadialBar,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell,
} from "recharts";
import { Card } from "../components.jsx";

/**
 * Shared analytics widgets used across the User, Parent and Admin dashboards:
 * scorecards, gauges, trend lines, gap bars, a dwell heatmap, a recommendation
 * list and small primitives. All theme-aware and chart-library-consistent.
 */

const TINTS = {
  indigo: "text-indigo-600 bg-indigo-50 dark:bg-indigo-500/15 dark:text-indigo-300",
  emerald: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "text-amber-600 bg-amber-50 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "text-rose-600 bg-rose-50 dark:bg-rose-500/15 dark:text-rose-300",
  sky: "text-sky-600 bg-sky-50 dark:bg-sky-500/15 dark:text-sky-300",
  slate: "text-slate-600 bg-slate-100 dark:bg-white/10 dark:text-slate-300",
};

export function DayToggle({ days, setDays, options = [7, 30, 90], onGradient = false }) {
  return (
    <div className={`flex gap-1 rounded-2xl p-1 ${onGradient ? "bg-white/20" : "bg-white/70 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-white/10"}`}>
      {options.map((d) => {
        const active = days === d;
        return (
          <button key={d} onClick={() => setDays(d)}
            className={`rounded-xl px-3 py-1.5 text-sm font-extrabold ${
              active ? (onGradient ? "bg-white text-indigo-600" : "bg-indigo-500 text-white")
                     : (onGradient ? "text-white/80" : "text-slate-500 dark:text-slate-400")}`}>
            {d}d
          </button>
        );
      })}
    </div>
  );
}

/** Gradient hero header — matches the project's GamificationDashboard look. */
export function Hero({ title, subtitle, icon: Icon, right }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-xl">
      <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-12 left-10 h-32 w-32 rounded-full bg-white/10" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {Icon ? <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20"><Icon className="h-6 w-6" /></span> : null}
          <div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-0.5 text-sm font-semibold text-white/80">{subtitle}</p> : null}
          </div>
        </div>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </div>
    </div>
  );
}

export function Scorecard({ icon: Icon, tint = "indigo", label, value, suffix = "", sub }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        {Icon ? <span className={`grid h-9 w-9 place-items-center rounded-2xl ${TINTS[tint]}`}><Icon className="h-[18px] w-[18px]" /></span> : null}
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-slate-800 dark:text-slate-100">
        {value == null ? "—" : value}{value != null && suffix}
      </p>
      {sub ? <p className="text-xs font-semibold text-slate-400">{sub}</p> : null}
    </Card>
  );
}

const GAUGE_COLOR = (v) => (v >= 80 ? "#10b981" : v >= 55 ? "#f59e0b" : "#f43f5e");

/** 0..100 ring gauge — engagement / integrity scores. */
export function Gauge({ value, label, size = 150 }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const data = [{ name: label, value: v, fill: GAUGE_COLOR(v) }];
  return (
    <div className="flex flex-col items-center">
      <div style={{ width: size, height: size }} className="relative">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart innerRadius="70%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
            <RadialBar background={{ fill: "rgba(148,163,184,0.18)" }} dataKey="value" cornerRadius={20} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-2xl font-extrabold" style={{ color: GAUGE_COLOR(v) }}>{value == null ? "—" : v}</span>
        </div>
      </div>
      <span className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>
    </div>
  );
}

export function Band({ value }) {
  const map = { high: ["emerald", "Strong"], medium: ["amber", "Fair"], low: ["rose", "Needs work"],
    clean: ["emerald", "Clean"], watch: ["amber", "Watch"], review: ["rose", "Review"] };
  const [tint, text] = map[value] || ["slate", value || "—"];
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${TINTS[tint]}`}>{text}</span>;
}

/** Generic multi-series line trend. series = [{key,label,color}] */
export function TrendLine({ data, xKey = "day", series, height = 240, yMax }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis dataKey={xKey} tick={{ fontSize: 10 }} minTickGap={24} />
        <YAxis tick={{ fontSize: 10 }} domain={yMax ? [0, yMax] : ["auto", "auto"]} width={34} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
            strokeWidth={2.4} dot={false} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal-ish bar list for concepts (accuracy / mastery / counts). */
export function GapBars({ data, xKey, barKey, color = "#6366f1", height = 260, colorByValue = false }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10 }} />
        <YAxis type="category" dataKey={xKey} tick={{ fontSize: 10 }} width={120} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Bar dataKey={barKey} radius={[0, 4, 4, 0]} fill={color} isAnimationActive={false}>
          {colorByValue && data.map((d, i) => (
            <Cell key={i} fill={d[barKey] >= 75 ? "#10b981" : d[barKey] >= 55 ? "#f59e0b" : "#f43f5e"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Simple severity/segment donut substitute: labelled stacked bar. */
export function SeverityMix({ high = 0, medium = 0, low = 0 }) {
  const total = Math.max(1, high + medium + low);
  const seg = (n, c) => (n > 0 ? <div style={{ width: `${(n / total) * 100}%`, background: c }} className="h-full" /> : null);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        {seg(high, "#f43f5e")}{seg(medium, "#f59e0b")}{seg(low, "#10b981")}
      </div>
      <div className="mt-2 flex gap-4 text-xs font-bold text-slate-500">
        <span className="text-rose-500">● High {high}</span>
        <span className="text-amber-500">● Medium {medium}</span>
        <span className="text-emerald-500">● Low {low}</span>
      </div>
    </div>
  );
}

const heatColor = (v) => {
  if (v == null) return "rgba(148,163,184,0.15)";
  if (v >= 80) return "#10b981";
  if (v >= 60) return "#84cc16";
  if (v >= 40) return "#f59e0b";
  return "#f43f5e";
};

/** Cells = [{label, value}] colour-scaled — concept accuracy heatmap. */
export function Heatmap({ cells = [] }) {
  if (!cells.length) return <Empty>No data yet.</Empty>;
  return (
    <div className="flex flex-wrap gap-2">
      {cells.map((c, i) => (
        <div key={i} title={`${c.label}: ${c.value ?? "—"}%`}
          className="flex min-w-[88px] flex-1 flex-col rounded-2xl p-2.5 text-white"
          style={{ background: heatColor(c.value) }}>
          <span className="truncate text-[11px] font-bold opacity-90">{c.label}</span>
          <span className="text-lg font-extrabold">{c.value == null ? "—" : `${c.value}%`}</span>
        </div>
      ))}
    </div>
  );
}

const PRIO = { high: "rose", medium: "amber", low: "sky" };
export function RecoList({ items = [] }) {
  if (!items.length) return <Empty>No recommendations — keep it up! 🎉</Empty>;
  return (
    <ul className="space-y-2">
      {items.map((r, i) => {
        const text = typeof r === "string" ? r : r.text;
        const tint = TINTS[PRIO[r.priority] || "slate"];
        return (
          <li key={i} className="flex items-start gap-2 rounded-xl border border-slate-100 p-3 text-sm font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">
            <span className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${tint}`}>{(typeof r === "object" && r.type) || "tip"}</span>
            <span>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Panel({ title, subtitle, right, children, className = "" }) {
  return (
    <Card className={`p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title ? <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{title}</h3> : null}
            {subtitle ? <p className="text-xs font-semibold text-slate-400">{subtitle}</p> : null}
          </div>
          {right}
        </div>
      )}
      {children}
    </Card>
  );
}

export function Empty({ children }) {
  return <p className="py-8 text-center text-sm font-semibold text-slate-400">{children}</p>;
}

/** Download an array-of-objects as CSV (admin exports). */
export function downloadCsv(rows, filename = "analytics.csv") {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
