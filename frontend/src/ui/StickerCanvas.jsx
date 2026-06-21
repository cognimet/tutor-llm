import React, { useEffect, useRef, useState } from "react";
import { Sparkles, Trash2, Loader2 } from "lucide-react";
import { gamificationApi } from "../api/endpoints.js";

/**
 * Junior Mode (Classes 1–4) Magic Sticker Canvas — spec §5.1 / §11.1.
 * Self-loads the student's unlocked stickers, lets them drag stickers from the
 * binder onto a themed sandbox, and persists each placement to the backend.
 */
export default function StickerCanvas() {
  const [stickers, setStickers] = useState(null);
  const [themes, setThemes] = useState([]);
  const [activeTheme, setActiveTheme] = useState("space");
  const canvasRef = useRef(null);

  useEffect(() => {
    let alive = true;
    gamificationApi.stickers()
      .then((d) => {
        if (!alive) return;
        setStickers(d.unlocked_stickers || []);
        const ts = d.available_canvas_themes?.length ? d.available_canvas_themes : ["space"];
        setThemes(ts);
        setActiveTheme(ts[0]);
      })
      .catch(() => { if (alive) setStickers([]); });
    return () => { alive = false; };
  }, []);

  const persist = (s) => {
    gamificationApi.placeSticker(s.id, {
      is_placed: s.is_placed,
      placed_x: s.placement?.x ?? null,
      placed_y: s.placement?.y ?? null,
      canvas_scale: s.placement?.scale ?? 1.0,
    }).catch(() => {});
  };

  const handleDragStart = (e, id) => e.dataTransfer.setData("text/plain", String(id));
  const handleDragOver = (e) => e.preventDefault();

  const handleDrop = (e) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const id = parseInt(e.dataTransfer.getData("text/plain"), 10);
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setStickers((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, is_placed: true, placement: { x, y, scale: s.placement?.scale || 1.0 } };
      persist(next);
      return next;
    }));
  };

  const removeSticker = (id) => {
    setStickers((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, is_placed: false, placement: null };
      persist(next);
      return next;
    }));
  };

  const themeBg = (t) => t === "safari"
    ? "radial-gradient(circle, #065f46 0%, #022c22 100%)"
    : t === "dino"
    ? "radial-gradient(circle, #78350f 0%, #451a03 100%)"
    : t === "cells"
    ? "radial-gradient(circle, #5b21b6 0%, #1e1b4b 100%)"
    : "radial-gradient(circle, #1e1b4b 0%, #030712 100%)";

  if (stickers === null) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-3xl border border-indigo-100 bg-white p-10 text-sm font-bold text-slate-400 dark:border-white/10 dark:bg-slate-800">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening your sticker book…
      </div>
    );
  }

  const placed = stickers.filter((s) => s.is_placed);
  const binder = stickers.filter((s) => !s.is_placed);

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-indigo-100 bg-gradient-to-b from-indigo-50/50 to-white p-6 shadow-xl dark:border-white/10 dark:from-slate-900 dark:to-slate-800">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-extrabold text-slate-800 dark:text-white">🎨 My Magic Sticker Canvas</h3>
          <p className="text-xs font-bold text-slate-400">Drag stickers from your binder onto your canvas!</p>
        </div>
        <select value={activeTheme} onChange={(e) => setActiveTheme(e.target.value)}
          className="rounded-2xl border border-indigo-200 bg-white px-4 py-2 text-sm font-extrabold text-indigo-700 shadow-sm dark:border-white/10 dark:bg-slate-800 dark:text-indigo-300">
          {["space", "safari", "dino", "cells"].map((t) => (
            <option key={t} value={t}>{{ space: "🌌 Deep Space", safari: "🦁 Safari Adventure", dino: "🦖 Prehistoric Valley", cells: "🦠 Microscopic Cells" }[t]}</option>
          ))}
        </select>
      </div>

      {/* Sandbox */}
      <div ref={canvasRef} onDragOver={handleDragOver} onDrop={handleDrop}
        className="relative h-96 w-full overflow-hidden rounded-3xl border-2 border-dashed border-indigo-200 shadow-inner dark:border-white/10"
        style={{ backgroundImage: themeBg(activeTheme) }}>
        {placed.map((s) => (
          <div key={s.id}
            className={`group absolute cursor-pointer transition-all hover:scale-110 ${s.is_shiny ? "animate-pulse" : ""}`}
            style={{ left: `${s.placement.x}%`, top: `${s.placement.y}%`, transform: "translate(-50%, -50%)" }}>
            <span className="block select-none text-5xl">{s.emoji}</span>
            {s.is_shiny && <Sparkles className="absolute -right-1 -top-1 h-4 w-4 animate-spin text-yellow-400" />}
            <button onClick={() => removeSticker(s.id)}
              className="absolute -left-3 -top-3 hidden h-6 w-6 place-items-center rounded-full bg-rose-500 text-white shadow-md group-hover:grid">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {!placed.length && (
          <div className="grid h-full place-items-center text-center text-sm font-bold text-white/70">
            Drag a sticker here to build your world! ✨
          </div>
        )}
      </div>

      {/* Binder */}
      <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-inner dark:border-white/5 dark:bg-slate-900/60">
        <p className="mb-3 text-xs font-extrabold uppercase tracking-wide text-slate-400">
          💼 My Sticker Binder ({binder.length} Unused)
        </p>
        {binder.length ? (
          <div className="flex flex-wrap gap-4">
            {binder.map((s) => (
              <div key={s.id} draggable onDragStart={(e) => handleDragStart(e, s.id)}
                className="relative cursor-grab rounded-2xl border border-slate-100 bg-slate-50 p-3 hover:bg-slate-100 active:cursor-grabbing dark:border-white/5 dark:bg-slate-800">
                <span className="block text-4xl">{s.emoji}</span>
                {s.is_shiny && (
                  <span className="absolute bottom-1 right-1 rounded-full bg-yellow-400 px-1 text-[8px] font-extrabold text-indigo-900">SHINY</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs font-semibold text-slate-400">
            {stickers.length ? "All stickers are on the canvas! 🎉" : "Earn stickers by leveling up and finishing quests! 🌟"}
          </p>
        )}
      </div>
    </div>
  );
}
