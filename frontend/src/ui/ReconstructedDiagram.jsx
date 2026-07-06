import React, { useEffect, useState, useRef, useMemo } from "react";
import { Play, Pause, RotateCcw, ZoomIn, ZoomOut, Info, X } from "lucide-react";

/**
 * Interactive SVG sketch engine for the Universal Vector Sketch Schema (UVSS).
 *
 * Renders a parsed diagram (from the student's own notes) and animates it
 * stroke-by-stroke — like a tutor drawing it live — with clickable hotspots
 * that reveal concept explanations. Driven entirely by the `data` schema:
 *   { id, title, canvas:{width,height,viewBox}, elements:[...], hotspots:[...] }
 *
 * Hardened for streamed/model-authored data: every field is optional and
 * defended, so a partial or slightly-malformed schema degrades to "draw what we
 * can" instead of throwing inside the chat.
 */
export default function ReconstructedDiagram({ data }) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [selectedHotspot, setSelectedHotspot] = useState(null);
  const [zoomScale, setZoomScale] = useState(1);
  const svgRef = useRef(null);

  // Defensive view of the schema.
  const elements = useMemo(
    () => (Array.isArray(data?.elements) ? data.elements.filter((e) => e && typeof e === "object") : []),
    [data],
  );
  const hotspots = useMemo(
    () => (Array.isArray(data?.hotspots) ? data.hotspots.filter((h) => h && h.element_id) : []),
    [data],
  );
  const elementById = useMemo(() => {
    const m = {};
    for (const el of elements) if (el.id != null) m[el.id] = el;
    return m;
  }, [elements]);

  const canvasWidth = Number(data?.canvas?.width) || 800;
  const canvasHeight = Number(data?.canvas?.height) || 600;
  const viewBox = data?.canvas?.viewBox || `0 0 ${canvasWidth} ${canvasHeight}`;

  // (Re)arm the draw animation whenever the schema changes or play toggles.
  useEffect(() => {
    if (!svgRef.current) return;
    const paths = svgRef.current.querySelectorAll(".anim-stroke");
    paths.forEach((path, i) => {
      let length = 0;
      try {
        length = path.getTotalLength();
      } catch {
        length = 0;
      }
      if (!length) return;
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
      path.style.animation = isPlaying
        ? `drawStroke 1.6s ease-out ${i * 0.28}s forwards`
        : "none";
      if (!isPlaying) path.style.strokeDashoffset = "0"; // paused → show finished
    });
  }, [data, elements, isPlaying]);

  const handleZoom = (dir) =>
    setZoomScale((p) => Math.max(0.5, Math.min(dir === "in" ? p + 0.15 : p - 0.15, 2.5)));

  const replay = () => {
    setIsPlaying(false);
    setTimeout(() => setIsPlaying(true), 50);
  };

  // Resolve a hotspot/text anchor's coordinates from its style (x/y or cx/cy).
  const anchorXY = (el) => ({
    x: Number(el?.style?.x ?? el?.style?.cx ?? 0),
    y: Number(el?.style?.y ?? el?.style?.cy ?? 0),
  });

  if (!elements.length) {
    return (
      <div className="my-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-slate-800/60">
        This diagram couldn't be reconstructed.
      </div>
    );
  }

  return (
    <div className="relative my-3 overflow-hidden rounded-3xl border border-indigo-500/20 bg-slate-950 p-4 text-white shadow-2xl">
      <style>{`
        @keyframes drawStroke { to { stroke-dashoffset: 0; } }
        @keyframes rdFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rdPulse {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.25); opacity: 1; filter: drop-shadow(0 0 8px rgba(16,185,129,0.8)); }
        }
        .rd-pulse { animation: rdPulse 2s infinite ease-in-out; cursor: pointer; transform-box: fill-box; transform-origin: center; }
        .rd-label { animation: rdFadeIn 0.6s ease forwards; animation-delay: 1.2s; opacity: 0; }
      `}</style>

      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest text-indigo-300">
            Reconstructed diagram
          </span>
          <h4 className="mt-1 text-sm font-extrabold text-slate-100">{data?.title || "Sketch"}</h4>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setIsPlaying((p) => !p)} title={isPlaying ? "Pause" : "Play"}
            className="rounded-xl bg-slate-900 p-2 hover:bg-slate-800 transition-colors">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button onClick={replay} title="Replay"
            className="rounded-xl bg-slate-900 p-2 hover:bg-slate-800 transition-colors">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button onClick={() => handleZoom("in")} title="Zoom in"
            className="rounded-xl bg-slate-900 p-2 hover:bg-slate-800 transition-colors">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={() => handleZoom("out")} title="Zoom out"
            className="rounded-xl bg-slate-900 p-2 hover:bg-slate-800 transition-colors">
            <ZoomOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Sketchboard */}
      <div className="relative flex justify-center overflow-hidden rounded-2xl border border-white/5 bg-slate-950/80 min-h-[320px]">
        <svg ref={svgRef} viewBox={viewBox}
          className="h-auto max-h-[460px] w-full transition-transform duration-300"
          style={{ transform: `scale(${zoomScale})` }}>
          {elements.map((el, i) => {
            const key = el.id ?? `el-${i}`;
            const type = el.type;
            if ((type === "path" || type === "edge") && el.stroke_path) {
              return (
                <path key={key} d={el.stroke_path} fill="none"
                  stroke={el.style?.stroke || "#818cf8"}
                  strokeWidth={el.style?.strokeWidth || 3}
                  strokeLinecap="round" strokeLinejoin="round" className="anim-stroke" />
              );
            }
            if (type === "node") {
              const { x, y } = anchorXY(el);
              return (
                <g key={key}>
                  <circle cx={x} cy={y} r={el.style?.r || 6} fill={el.style?.fill || "#6366f1"} />
                  {el.label && (
                    <text x={x} y={y - 12} fill={el.style?.fill || "#c7d2fe"} fontSize={el.style?.fontSize || 12}
                      fontWeight="bold" textAnchor="middle" className="rd-label select-none">{el.label}</text>
                  )}
                </g>
              );
            }
            if (type === "text" && el.label != null) {
              return (
                <text key={key} x={Number(el.style?.x) || 0} y={Number(el.style?.y) || 0}
                  fill={el.style?.fill || "#ffffff"} fontSize={el.style?.fontSize || 13}
                  fontWeight="bold" textAnchor="middle" className="rd-label select-none">{el.label}</text>
              );
            }
            return null;
          })}

          {/* Interactive hotspots */}
          {hotspots.map((h, i) => {
            const el = elementById[h.element_id];
            if (!el) return null;
            const { x, y } = anchorXY(el);
            return (
              <g key={`hs-${i}`} onClick={() => setSelectedHotspot(h)} className="rd-pulse">
                <circle cx={x} cy={y} r={8} fill="#10b981" />
                <circle cx={x} cy={y} r={15} fill="none" stroke="#10b981" strokeWidth={2} className="animate-ping" />
              </g>
            );
          })}
        </svg>

        {/* Concept overlay */}
        {selectedHotspot && (
          <div className="absolute bottom-3 left-3 right-3 rounded-2xl border border-emerald-500/20 bg-slate-900/90 p-4 shadow-xl backdrop-blur-md">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-emerald-400" />
                <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-400">Concept spotlight</p>
              </div>
              <button onClick={() => setSelectedHotspot(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/15">
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="mt-1 text-sm font-extrabold text-white">
              {elementById[selectedHotspot.element_id]?.label || "Detail"}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{selectedHotspot.explanation}</p>
          </div>
        )}
      </div>
    </div>
  );
}
