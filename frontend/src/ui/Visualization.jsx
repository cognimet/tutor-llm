import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine,
} from "recharts";
import { sample } from "./mathEval.js";

/**
 * Inline tutor visualization. Renders a structured spec (parsed from a ```viz
 * fenced JSON block) — never arbitrary HTML/JS, so it's safe to show untrusted
 * model output. Supported `type`s:
 *   function | plot   — y=f(x) line plot(s) via a safe expression evaluator
 *   line | bar | scatter | pie — data charts (recharts)
 *   diagram           — Mermaid (flowchart/cycle/mindmap/timeline)
 *   geometry          — coordinate SVG (points/segments/polygons/circles/angles)
 * Any spec error degrades to a labelled notice + the raw spec, never a crash.
 */

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9",
                 "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

/* ---------------------------------------------------------------- shell */

class VizErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Frame({ title, children }) {
  return (
    <figure className="my-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {title ? (
        <figcaption className="border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs font-bold text-slate-600">
          {title}
        </figcaption>
      ) : null}
      <div className="p-3">{children}</div>
    </figure>
  );
}

function Fallback({ note, raw }) {
  return (
    <Frame title="Visualization unavailable">
      <p className="mb-2 text-xs text-slate-500">{note || "This visualization couldn't be rendered."}</p>
      {raw ? (
        <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
          {raw}
        </pre>
      ) : null}
    </Frame>
  );
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/* ----------------------------------------------------------- function plot */

function FunctionPlot({ spec }) {
  const fns = useMemo(() => {
    const list = Array.isArray(spec.fns) ? spec.fns
      : spec.expr ? [{ expr: spec.expr, label: spec.label }] : [];
    return list.filter((f) => f && f.expr);
  }, [spec]);

  const domain = Array.isArray(spec.domain) ? spec.domain : [-10, 10];
  const lo = num(domain[0], -10), hi = num(domain[1], 10);

  const { data, series, error } = useMemo(() => {
    const ser = fns.map((f, i) => ({
      key: `y${i}`,
      label: f.label || f.expr,
      color: f.color || PALETTE[i % PALETTE.length],
      ...sample(f.expr, lo, hi, 240),
    }));
    const ok = ser.filter((s) => !s.error && s.points.length);
    if (!ok.length) return { data: [], series: [], error: ser[0]?.error || "no valid function" };
    // All share the same x grid (same domain/steps); merge by index.
    const base = ok[0].points;
    const merged = base.map((p, idx) => {
      const row = { x: p.x };
      ok.forEach((s) => { row[s.key] = s.points[idx] ? s.points[idx].y : null; });
      return row;
    });
    return { data: merged, series: ok, error: null };
  }, [fns, lo, hi]);

  if (error) return <Fallback note={`Couldn't plot: ${error}`} raw={JSON.stringify(spec, null, 1)} />;

  const yDomain = Array.isArray(spec.range)
    ? [num(spec.range[0], "auto"), num(spec.range[1], "auto")] : ["auto", "auto"];

  return (
    <Frame title={spec.title}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey="x" type="number" domain={[lo, hi]} tick={{ fontSize: 11 }}
                 tickFormatter={(v) => (Math.abs(v) < 1e-9 ? "0" : v)} allowDecimals />
          <YAxis type="number" domain={yDomain} tick={{ fontSize: 11 }} width={44} />
          <Tooltip formatter={(v) => (v == null ? "—" : Number(v).toPrecision(4))}
                   labelFormatter={(l) => `x = ${l}`} contentStyle={{ fontSize: 12 }} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          <ReferenceLine x={0} stroke="#cbd5e1" />
          <ReferenceLine y={0} stroke="#cbd5e1" />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                  stroke={s.color} dot={false} strokeWidth={2.2}
                  isAnimationActive={false} connectNulls={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

/* --------------------------------------------------------------- data charts */

function normalizeData(spec) {
  const data = Array.isArray(spec.data) ? spec.data : [];
  const xKey = spec.xKey || (data[0] && "label" in data[0] ? "label" : "x");
  // series: explicit, else infer numeric keys other than xKey
  let series = Array.isArray(spec.series) ? spec.series.map((s, i) => ({
    key: s.key || s.dataKey, label: s.label || s.key, color: s.color || PALETTE[i % PALETTE.length],
  })) : null;
  if (!series) {
    const keys = data.length
      ? Object.keys(data[0]).filter((k) => k !== xKey && typeof data[0][k] === "number")
      : [];
    const guess = keys.length ? keys : ["value"];
    series = guess.map((k, i) => ({ key: k, label: k === "value" ? (spec.yLabel || "value") : k, color: PALETTE[i % PALETTE.length] }));
  }
  return { data, xKey, series };
}

function DataChart({ spec }) {
  const { data, xKey, series } = useMemo(() => normalizeData(spec), [spec]);
  if (!data.length) return <Fallback note="No data points provided." raw={JSON.stringify(spec, null, 1)} />;

  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
      <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} width={40} />
      <Tooltip contentStyle={{ fontSize: 12 }} />
      {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
    </>
  );

  let chart;
  if (spec.type === "line") {
    chart = (
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        {common}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={s.color} strokeWidth={2.2} dot isAnimationActive={false} />
        ))}
      </LineChart>
    );
  } else if (spec.type === "scatter") {
    chart = (
      <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis dataKey={spec.xKey || "x"} type="number" tick={{ fontSize: 11 }} name={spec.xLabel || "x"} />
        <YAxis dataKey={series[0].key} type="number" tick={{ fontSize: 11 }} width={40} name={spec.yLabel || "y"} />
        <ZAxis range={[60, 60]} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ fontSize: 12 }} />
        <Scatter data={data} fill={series[0].color} isAnimationActive={false} />
      </ScatterChart>
    );
  } else {
    chart = (
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        {common}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color}
               radius={[4, 4, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    );
  }

  return (
    <Frame title={spec.title}>
      <ResponsiveContainer width="100%" height={260}>{chart}</ResponsiveContainer>
    </Frame>
  );
}

function PieChartViz({ spec }) {
  const data = Array.isArray(spec.data) ? spec.data : [];
  if (!data.length) return <Fallback note="No data points provided." raw={JSON.stringify(spec, null, 1)} />;
  const nameKey = spec.xKey || ("label" in (data[0] || {}) ? "label" : "name");
  const valueKey = spec.yKey || ("value" in (data[0] || {}) ? "value" : "y");
  return (
    <Frame title={spec.title}>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey={nameKey} cx="50%" cy="50%"
               outerRadius={90} label={(e) => e[nameKey]} isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </Frame>
  );
}

/* ----------------------------------------------------------------- geometry */

function Geometry({ spec }) {
  const els = Array.isArray(spec.elements) ? spec.elements : [];
  const W = 440, H = 320, M = 28;

  const view = useMemo(() => {
    const xs = [], ys = [];
    const eat = (p) => { if (Array.isArray(p)) { xs.push(num(p[0], 0)); ys.push(num(p[1], 0)); } };
    for (const e of els) {
      if (e.kind === "point" || e.kind === "label") eat([e.x, e.y]);
      if (e.from) eat(e.from); if (e.to) eat(e.to); if (e.at) eat(e.at);
      if (Array.isArray(e.points)) e.points.forEach(eat);
      if (e.center) { eat(e.center); const r = num(e.r, 0); xs.push(num(e.center[0], 0) + r, num(e.center[0], 0) - r); ys.push(num(e.center[1], 0) + r, num(e.center[1], 0) - r); }
    }
    if (Array.isArray(spec.xRange)) xs.push(num(spec.xRange[0], 0), num(spec.xRange[1], 0));
    if (Array.isArray(spec.yRange)) ys.push(num(spec.yRange[0], 0), num(spec.yRange[1], 0));
    if (!xs.length) { xs.push(-1, 5); ys.push(-1, 5); }
    let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    if (xmin === xmax) { xmin -= 1; xmax += 1; }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const padX = (xmax - xmin) * 0.12, padY = (ymax - ymin) * 0.12;
    xmin -= padX; xmax += padX; ymin -= padY; ymax += padY;
    // equal aspect so circles stay round and right angles square
    const scale = Math.min((W - 2 * M) / (xmax - xmin), (H - 2 * M) / (ymax - ymin));
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
    const sx = (x) => W / 2 + (num(x, 0) - cx) * scale;
    const sy = (y) => H / 2 - (num(y, 0) - cy) * scale;
    return { sx, sy, scale, xmin, xmax, ymin, ymax };
  }, [els, spec]);

  const { sx, sy, scale, xmin, xmax, ymin, ymax } = view;
  const showAxes = spec.axes !== false;

  return (
    <Frame title={spec.title}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 340 }} role="img">
        {showAxes && ymin <= 0 && ymax >= 0 && (
          <line x1={sx(xmin)} y1={sy(0)} x2={sx(xmax)} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        )}
        {showAxes && xmin <= 0 && xmax >= 0 && (
          <line x1={sx(0)} y1={sy(ymin)} x2={sx(0)} y2={sy(ymax)} stroke="#cbd5e1" strokeWidth="1" />
        )}
        {els.map((e, i) => <GeoElement key={i} e={e} sx={sx} sy={sy} scale={scale} idx={i} />)}
      </svg>
    </Frame>
  );
}

function GeoElement({ e, sx, sy, scale, idx }) {
  const color = e.color || PALETTE[idx % PALETTE.length];
  const fill = e.fill || color;
  if (e.kind === "point" || e.kind === "label") {
    const px = sx(e.x), py = sy(e.y);
    return (
      <g>
        {e.kind === "point" && <circle cx={px} cy={py} r="3.5" fill={color} />}
        {e.label && <text x={px + 6} y={py - 6} fontSize="12" fill="#334155">{e.label}</text>}
      </g>
    );
  }
  if (e.kind === "segment" || e.kind === "vector") {
    const [x1, y1] = e.from || [0, 0], [x2, y2] = e.to || [0, 0];
    const mx = (sx(x1) + sx(x2)) / 2, my = (sy(y1) + sy(y2)) / 2;
    return (
      <g>
        <line x1={sx(x1)} y1={sy(y1)} x2={sx(x2)} y2={sy(y2)} stroke={color} strokeWidth="2"
              markerEnd={e.kind === "vector" ? `url(#arrow-${idx})` : undefined} />
        {e.kind === "vector" && (
          <defs>
            <marker id={`arrow-${idx}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={color} />
            </marker>
          </defs>
        )}
        {e.label && <text x={mx + 5} y={my - 5} fontSize="12" fill="#334155">{e.label}</text>}
      </g>
    );
  }
  if (e.kind === "polygon" || e.kind === "polyline") {
    const pts = (e.points || []).map((p) => `${sx(p[0])},${sy(p[1])}`).join(" ");
    const Shape = e.kind === "polygon" ? "polygon" : "polyline";
    return (
      <g>
        <Shape points={pts} fill={e.kind === "polygon" ? `${fill}22` : "none"} stroke={color} strokeWidth="2" />
        {(e.points || []).map((p, j) => (
          <g key={j}>
            <circle cx={sx(p[0])} cy={sy(p[1])} r="3" fill={color} />
            {e.labels && e.labels[j] && (
              <text x={sx(p[0]) + 6} y={sy(p[1]) - 6} fontSize="12" fill="#334155">{e.labels[j]}</text>
            )}
          </g>
        ))}
      </g>
    );
  }
  if (e.kind === "circle") {
    const [cx, cy] = e.center || [0, 0];
    return (
      <g>
        <circle cx={sx(cx)} cy={sy(cy)} r={num(e.r, 1) * scale} fill={`${fill}18`} stroke={color} strokeWidth="2" />
        <circle cx={sx(cx)} cy={sy(cy)} r="2.5" fill={color} />
        {e.label && <text x={sx(cx) + 6} y={sy(cy) - 6} fontSize="12" fill="#334155">{e.label}</text>}
      </g>
    );
  }
  if (e.kind === "angle") {
    const [ax, ay] = e.at || [0, 0];
    const a1 = Math.atan2(sy(e.from?.[1] ?? 0) - sy(ay), sx(e.from?.[0] ?? 1) - sx(ax));
    const a2 = Math.atan2(sy(e.to?.[1] ?? 1) - sy(ay), sx(e.to?.[0] ?? 0) - sx(ax));
    const r = 22;
    const x1 = sx(ax) + r * Math.cos(a1), y1 = sy(ay) + r * Math.sin(a1);
    const x2 = sx(ax) + r * Math.cos(a2), y2 = sy(ay) + r * Math.sin(a2);
    const large = Math.abs(a2 - a1) > Math.PI ? 1 : 0;
    const sweep = a2 > a1 ? 1 : 0;
    return (
      <g>
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`} fill="none" stroke={color} strokeWidth="1.5" />
        {e.label && <text x={sx(ax) + (e.from?.[0] >= 0 ? 10 : -22)} y={sy(ay) - 8} fontSize="11" fill="#334155">{e.label}</text>}
      </g>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ mermaid */

// Models frequently emit slightly-invalid Mermaid: cosmetic `style`/`classDef`/
// `click`/`linkStyle` directives (the most error-prone), stray control chars, or
// a leaked ``` fence. Strip those so a clean factor tree / flowchart still
// renders. We keep the actual nodes + edges (and any non-ASCII LABEL text, e.g.
// Hindi) untouched — only structural noise is removed.
const DIAGRAM_HEAD = /^\s*(graph\s+(?:TD|TB|BT|RL|LR)|flowchart\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|mindmap|timeline|gantt|pie|journey)\b/i;
// Diagram types where node labels live inside [] {} () and can carry special
// characters. For these we quote labels; for the others (sequence, etc.) the
// syntax differs, so we leave statements as-is.
const FLOW_HEAD = /^\s*(graph|flowchart)\b/i;

// Wrap a node label in double quotes so `:` `(` `)` `>` `?` `,` etc. are treated
// as literal text, not Mermaid syntax (the #1 cause of "Parse error … got …").
const cleanLabel = (s) => s.trim().replace(/^["']+|["']+$/g, "").replace(/"/g, "'").trim();
function quoteNodeLabels(stmt) {
  // Quote [] and {} labels (the shapes models actually use). Parens that appear
  // inside a label — e.g. r(x) in [final r(x)] — are protected once the square
  // label is quoted, so we deliberately don't quote round () nodes (doing so
  // would re-match those inner parens and corrupt the string).
  return stmt
    .replace(/\[([^\[\]]+)\]/g, (_, t) => `["${cleanLabel(t)}"]`)
    .replace(/\{([^{}]+)\}/g, (_, t) => `{"${cleanLabel(t)}"}`);
}

function sanitizeMermaid(src) {
  let code = String(src || "").trim()
    .replace(/^```(?:mermaid)?/i, "").replace(/```$/, "")
    // strip C0/C1 control chars (keep \t \n \r) that break Mermaid's lexer
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
    .trim();
  const head = code.match(DIAGRAM_HEAD);
  const header = head ? head[0].trim() : "graph TD";
  const rest = head ? code.slice(head[0].length) : code;
  const isFlow = FLOW_HEAD.test(header);
  const stmts = rest
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^(style|classDef|class|linkStyle|click|%%|theme)\b/i.test(s))
    .map((s) => (isFlow ? quoteNodeLabels(s) : s));
  return { code: `${header}\n${stmts.join("\n")}`, hasBody: stmts.length > 0 };
}

function Diagram({ spec }) {
  const ref = useRef(null);
  const [err, setErr] = useState(null);
  const { code, hasBody } = useMemo(
    () => sanitizeMermaid(spec.mermaid || spec.code || ""), [spec]);

  useEffect(() => {
    let alive = true;
    if (!hasBody) return undefined;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral",
                             fontFamily: "inherit" });
        const id = `viz-mmd-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (alive && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (alive) setErr(e?.message || "diagram failed to render");
      }
    })();
    return () => { alive = false; };
  }, [code, hasBody]);

  if (!hasBody) return <Fallback note="Empty diagram." raw={JSON.stringify(spec, null, 1)} />;
  if (err) return <Fallback note={`Diagram error: ${err}`} raw={code} />;
  return (
    <Frame title={spec.title}>
      <div ref={ref} className="flex justify-center overflow-auto [&_svg]:max-w-full" />
    </Frame>
  );
}

/* -------------------------------------------------------------------- entry */

// LLMs routinely emit visualization specs with raw (unescaped) control
// characters — most often literal newlines/tabs inside a multi-line `mermaid`
// graph string. Strict JSON.parse rejects those ("Bad control character in
// string literal"). This walker re-escapes \n \r \t that appear *inside* string
// literals, leaving structural whitespace alone, so an otherwise-valid spec
// still parses instead of degrading to the "not valid JSON" notice.
function escapeControlCharsInStrings(src) {
  let out = "", inStr = false, escaped = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else {
      if (ch === '"') { inStr = true; }
      out += ch;
    }
  }
  return out;
}

// Tolerant spec parser: try strict JSON first, then a repaired pass. Returns the
// parsed object or null. Exported so RichMessage detects these specs too.
export function parseVizSpec(code) {
  const raw = String(code ?? "");
  try { return JSON.parse(raw); } catch { /* fall through to repair */ }
  try { return JSON.parse(escapeControlCharsInStrings(raw)); } catch { return null; }
}

export default function Visualization({ code, spec: specProp }) {
  const parsed = useMemo(() => {
    if (specProp && typeof specProp === "object") return { spec: specProp, error: null };
    const spec = parseVizSpec(code);
    return spec ? { spec, error: null } : { spec: null, error: "invalid spec" };
  }, [code, specProp]);

  if (!parsed.spec) return <Fallback note="The visualization spec wasn't valid JSON." raw={code} />;
  const spec = parsed.spec;
  const type = String(spec.type || "function").toLowerCase();

  const body = (() => {
    switch (type) {
      case "function":
      case "plot": return <FunctionPlot spec={spec} />;
      case "line":
      case "bar":
      case "scatter": return <DataChart spec={spec} />;
      case "pie": return <PieChartViz spec={spec} />;
      case "geometry": return <Geometry spec={spec} />;
      case "diagram":
      case "mermaid":
      case "flowchart": return <Diagram spec={spec} />;
      default: return <Fallback note={`Unknown visualization type "${type}".`} raw={JSON.stringify(spec, null, 1)} />;
    }
  })();

  return (
    <VizErrorBoundary fallback={<Fallback note="This visualization hit a rendering error." raw={JSON.stringify(spec, null, 1)} />}>
      {body}
    </VizErrorBoundary>
  );
}
