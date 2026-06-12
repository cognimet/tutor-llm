import React, { useEffect, useRef, useState } from "react";
import {
  X, PenLine, Highlighter, Eraser, Minus, MoveUpRight,
  Square as SquareIcon, Circle, Undo2, Redo2, Trash2, Download, Sparkles,
} from "lucide-react";

/**
 * Built-in whiteboard — the "playground" surface of the tutor chat.
 *
 * Students sketch their working (equations, diagrams, steps) and hit
 * "Ask tutor": the board is exported as a PNG and sent through the same
 * OCR rail as snap-a-doubt, so the tutor reads the work and coaches on it.
 *
 * Dependency-free: plain <canvas> + pointer events (mouse / touch / stylus).
 * Strokes are kept as vectors so undo / redo / resize redraw losslessly;
 * the parent persists them via onChange so the board survives close/reopen.
 */

const INKS = ["#0f172a", "#4f46e5", "#e11d48", "#059669", "#d97706", "#0284c7"];
const SIZES = [2.5, 4, 7];

const TOOLS = [
  { id: "pen",     icon: PenLine,     label: "Pen" },
  { id: "hl",      icon: Highlighter, label: "Highlighter" },
  { id: "erase",   icon: Eraser,      label: "Eraser" },
  { id: "line",    icon: Minus,       label: "Line" },
  { id: "arrow",   icon: MoveUpRight, label: "Arrow" },
  { id: "rect",    icon: SquareIcon,  label: "Rectangle" },
  { id: "ellipse", icon: Circle,      label: "Ellipse" },
];
const SHAPES = new Set(["line", "arrow", "rect", "ellipse"]);

function drawArrowHead(ctx, a, b, size) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const len = Math.max(12, size * 4);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - len * Math.cos(angle - Math.PI / 6), b.y - len * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - len * Math.cos(angle + Math.PI / 6), b.y - len * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

// Render one stroke (freehand path or shape) onto a 2D context.
function drawStroke(ctx, s) {
  const pts = s.points;
  if (!pts || !pts.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  if (s.tool === "hl") { ctx.globalAlpha = 0.35; ctx.lineWidth = s.size * 3; }
  if (s.tool === "erase") { ctx.globalCompositeOperation = "destination-out"; ctx.lineWidth = s.size * 6; }

  const a = pts[0];
  const b = pts[pts.length - 1];
  if (SHAPES.has(s.tool)) {
    ctx.beginPath();
    if (s.tool === "line" || s.tool === "arrow") {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (s.tool === "arrow") drawArrowHead(ctx, a, b, s.size);
    } else if (s.tool === "rect") {
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else {
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (pts.length < 3) {
    // A tap — draw a dot.
    ctx.beginPath();
    ctx.fillStyle = s.color;
    ctx.arc(a.x, a.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Freehand: quadratic smoothing through midpoints.
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

export default function Whiteboard({
  topicName,
  grad = "from-indigo-500 to-violet-500",
  initialStrokes = [],
  onChange,
  onAsk,
  onClose,
}) {
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(INKS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [strokes, setStrokes] = useState(initialStrokes);
  const [redoStack, setRedoStack] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const committedRef = useRef(null); // offscreen canvas of committed strokes
  const liveRef = useRef(null);      // the in-flight stroke
  const strokesRef = useRef(initialStrokes);

  // Lock background scroll while the board is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Copy the committed layer onto the visible canvas (exact pixel copy).
  const blit = () => {
    const cv = canvasRef.current;
    const com = committedRef.current;
    if (!cv || !com) return;
    const ctx = cv.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(com, 0, 0);
    ctx.restore();
  };

  // Replay every stroke onto the committed layer (undo / redo / resize).
  const rebuild = () => {
    const com = committedRef.current;
    if (!com) return;
    const ctx = com.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, com.width, com.height);
    ctx.restore();
    for (const s of strokesRef.current) drawStroke(ctx, s);
    blit();
  };

  // Size both canvases to the board, crisp on retina, redraw on resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    if (!committedRef.current) committedRef.current = document.createElement("canvas");
    const com = committedRef.current;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      for (const c of [cv, com]) {
        c.width = Math.max(1, Math.round(w * dpr));
        c.height = Math.max(1, Math.round(h * dpr));
        c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      rebuild();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyStrokes = (next) => {
    strokesRef.current = next;
    setStrokes(next);
    onChange?.(next);
    rebuild();
  };

  const commit = (s) => {
    drawStroke(committedRef.current.getContext("2d"), s);
    blit();
    setRedoStack([]);
    const next = [...strokesRef.current, s];
    strokesRef.current = next;
    setStrokes(next);
    onChange?.(next);
  };

  const undo = () => {
    const cur = strokesRef.current;
    if (!cur.length) return;
    setRedoStack((r) => [cur[cur.length - 1], ...r]);
    applyStrokes(cur.slice(0, -1));
  };

  const redoOne = () => {
    if (!redoStack.length) return;
    const [head, ...rest] = redoStack;
    setRedoStack(rest);
    applyStrokes([...strokesRef.current, head]);
  };

  const clearAll = () => {
    if (!strokesRef.current.length) return;
    setRedoStack([]);
    applyStrokes([]);
  };

  // Esc closes; ⌘/Ctrl+Z undo; +Shift (or ⌘/Ctrl+Y) redo.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redoOne(); else undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redoOne(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ------------------------------------------------------ pointer drawing */

  const posOf = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e) => {
    if (busy || liveRef.current) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    liveRef.current = { tool, color, size, pointerId: e.pointerId, points: [posOf(e)] };
    setDrawing(true);
    if (!SHAPES.has(tool)) drawStroke(canvasRef.current.getContext("2d"), liveRef.current);
  };

  const onMove = (e) => {
    const live = liveRef.current;
    if (!live || e.pointerId !== live.pointerId) return;
    e.preventDefault();
    const p = posOf(e);
    const ctx = canvasRef.current.getContext("2d");
    if (SHAPES.has(live.tool)) {
      live.points = [live.points[0], p];
      blit();
      drawStroke(ctx, live);
    } else {
      const prev = live.points[live.points.length - 1];
      live.points.push(p);
      // Quick straight segment while drawing; smoothed on commit.
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = live.color;
      ctx.lineWidth = live.size;
      if (live.tool === "hl") { ctx.globalAlpha = 0.35; ctx.lineWidth = live.size * 3; }
      if (live.tool === "erase") { ctx.globalCompositeOperation = "destination-out"; ctx.lineWidth = live.size * 6; }
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }
  };

  const onUp = (e) => {
    const live = liveRef.current;
    if (!live || (e && e.pointerId !== live.pointerId)) return;
    liveRef.current = null;
    setDrawing(false);
    commit(live);
  };

  /* -------------------------------------------------------- export / ask */

  // Export at full resolution on a white background (clean for OCR).
  const exportBlob = () => new Promise((resolve, reject) => {
    const com = committedRef.current;
    const out = document.createElement("canvas");
    out.width = com.width;
    out.height = com.height;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(com, 0, 0);
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png");
  });

  const download = async () => {
    if (!strokes.length) return;
    try {
      const blob = await exportBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = (topicName || "whiteboard").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      a.href = url;
      a.download = `${slug || "whiteboard"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* ignore */ }
  };

  const ask = async () => {
    if (busy || !strokes.length) return;
    setBusy(true);
    setErr("");
    try {
      const blob = await exportBlob();
      await onAsk(blob); // parent closes the board and sends on success
    } catch (e) {
      setErr(e?.userMessage || "I couldn't read the board — try writing a little larger and clearer.");
      setBusy(false);
    }
  };

  /* ----------------------------------------------------------------- UI */

  const toolBtn = (active) =>
    `grid h-9 w-9 place-items-center rounded-xl transition-colors ${
      active
        ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-white/10"
    }`;
  const iconBtn =
    "grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-white/10";
  const divider = <span className="mx-0.5 h-6 w-px shrink-0 bg-slate-200 dark:bg-white/10" />;

  return (
    <div className="msg-in fixed inset-0 z-[60] flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <p className="flex min-w-0 items-center gap-2 text-sm font-extrabold text-slate-800 dark:text-slate-100">
          <PenLine className="h-4 w-4 shrink-0 text-indigo-500" />
          Whiteboard
          <span className="hidden truncate text-xs font-bold text-slate-400 sm:inline">· {topicName}</span>
        </p>
        <p className="ml-auto hidden text-[11px] font-bold text-slate-400 md:block">
          Write big and clear — the tutor reads your board when you ask.
        </p>
        <button onClick={onClose} title="Close (Esc)" aria-label="Close whiteboard"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-slate-900 dark:text-slate-300 dark:ring-white/10 dark:hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Board */}
      <div className="relative mx-3 flex-1 overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-200 dark:ring-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(100,116,139,0.16)_1px,transparent_0)] [background-size:24px_24px]" />
        <div ref={wrapRef} className="absolute inset-0">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 cursor-crosshair touch-none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
        {!strokes.length && !drawing && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm font-bold text-slate-300">
            Work it out here — equations, diagrams, steps…
          </p>
        )}
        {err && (
          <button onClick={() => setErr("")}
            className="absolute inset-x-0 top-3 z-10 mx-auto w-fit max-w-[92%] rounded-2xl bg-rose-50 px-4 py-2 text-left text-xs font-extrabold text-rose-600 shadow ring-1 ring-rose-200">
            {err}
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex justify-center px-3 py-3">
        <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl bg-white/95 p-1.5 shadow-lg ring-1 ring-slate-200 backdrop-blur dark:bg-slate-800/95 dark:ring-white/10">
          {TOOLS.map((tl) => (
            <button key={tl.id} onClick={() => setTool(tl.id)} title={tl.label} aria-label={tl.label}
              className={toolBtn(tool === tl.id)}>
              <tl.icon className="h-[18px] w-[18px]" />
            </button>
          ))}
          {divider}
          {INKS.map((c) => (
            <button key={c} onClick={() => { setColor(c); if (tool === "erase") setTool("pen"); }}
              title="Ink color" aria-label={`Ink ${c}`}
              className={`h-6 w-6 shrink-0 rounded-full ring-2 ring-offset-1 transition-transform dark:ring-offset-slate-800 ${
                color === c ? "scale-110 ring-indigo-400" : "ring-transparent hover:scale-110"
              }`}
              style={{ background: c }}
            />
          ))}
          {divider}
          {SIZES.map((s) => (
            <button key={s} onClick={() => setSize(s)} title={`Stroke ${s < 3 ? "thin" : s < 6 ? "medium" : "thick"}`}
              className={toolBtn(size === s)}>
              <span className="rounded-full bg-current" style={{ width: s * 2, height: s * 2 }} />
            </button>
          ))}
          {divider}
          <button onClick={undo} disabled={!strokes.length} title={`Undo (${/Mac/.test(navigator.platform) ? "⌘" : "Ctrl"}+Z)`} className={iconBtn}>
            <Undo2 className="h-[18px] w-[18px]" />
          </button>
          <button onClick={redoOne} disabled={!redoStack.length} title="Redo" className={iconBtn}>
            <Redo2 className="h-[18px] w-[18px]" />
          </button>
          <button onClick={clearAll} disabled={!strokes.length} title="Clear board" className={iconBtn}>
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
          <button onClick={download} disabled={!strokes.length} title="Download as image" className={iconBtn}>
            <Download className="h-[18px] w-[18px]" />
          </button>
          {divider}
          <button onClick={ask} disabled={busy || !strokes.length}
            className={`ml-0.5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-br ${grad} px-3.5 text-xs font-extrabold text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-40`}>
            {busy
              ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              : <Sparkles className="h-4 w-4" />}
            {busy ? "Reading your board…" : "Ask tutor"}
          </button>
        </div>
      </div>
    </div>
  );
}
