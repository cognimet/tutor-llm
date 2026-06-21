import React, { useEffect, useRef, useState } from "react";

/**
 * Tuto the Owl — the interactive companion mascot (spec §4). A small SVG owl
 * that reacts to a `state` prop with the emotional state machine:
 *   idle → reading → thinking → celebrating / comforting → idle, and sleeping
 *   after long inactivity. Tapping wakes a sleeping Tuto.
 *
 * Props:
 *   state    — "idle" | "reading" | "thinking" | "celebrating" | "comforting" | "sleeping"
 *   onTap    — click handler (returns a voice line in the caller if wanted)
 *   size     — px (default 96)
 *   line     — optional speech-bubble text
 */
export default function TutoMascot({ state = "idle", onTap, size = 96, line = "" }) {
  const [local, setLocal] = useState(state);
  const idleTimer = useRef(null);

  useEffect(() => { setLocal(state); }, [state]);

  // Drift to sleep after 60s of staying idle.
  useEffect(() => {
    clearTimeout(idleTimer.current);
    if (local === "idle") {
      idleTimer.current = setTimeout(() => setLocal("sleeping"), 60000);
    }
    return () => clearTimeout(idleTimer.current);
  }, [local]);

  const anim = {
    idle: "tuto-bob",
    reading: "",
    thinking: "tuto-bob",
    celebrating: "tuto-spin",
    comforting: "",
    sleeping: "tuto-breathe",
  }[local] || "tuto-bob";

  const wake = () => { setLocal("idle"); onTap?.(); };

  const bubble = line || {
    celebrating: "Woohoo! 🎉",
    comforting: "We got this! 💛",
    sleeping: "Zzz… tap me!",
    thinking: "Hmm, let me think…",
    reading: "Ooh, reading! 📖",
    idle: "",
  }[local];

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      {bubble && (
        <div className="msg-in rounded-2xl bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 shadow ring-1 ring-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:ring-white/10">
          {bubble}
        </div>
      )}
      <button onClick={wake} aria-label="Tuto the owl" className={`relative ${anim}`} style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size}>
          {/* body */}
          <ellipse cx="50" cy="58" rx="30" ry="32" fill="#7c5cff" />
          <ellipse cx="50" cy="62" rx="20" ry="22" fill="#a99bff" />
          {/* ear tufts */}
          <path d="M28 32 L34 14 L42 30 Z" fill="#6d4df0" />
          <path d="M72 32 L66 14 L58 30 Z" fill="#6d4df0" />
          {/* eyes */}
          {local === "sleeping" ? (
            <>
              <path d="M34 44 q6 6 12 0" stroke="#1e1b4b" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M54 44 q6 6 12 0" stroke="#1e1b4b" strokeWidth="3" fill="none" strokeLinecap="round" />
            </>
          ) : (
            <>
              <circle cx="40" cy="44" r="11" fill="#fff" />
              <circle cx="60" cy="44" r="11" fill="#fff" />
              <circle cx={local === "thinking" ? 43 : 40} cy="45" r="5" fill="#1e1b4b" />
              <circle cx={local === "thinking" ? 63 : 60} cy="45" r="5" fill="#1e1b4b" />
              {local === "celebrating" && (
                <>
                  <circle cx="40" cy="45" r="5" fill="#1e1b4b" />
                  <path d="M33 38 l14 4 M53 42 l14 -4" stroke="#facc15" strokeWidth="2" />
                </>
              )}
            </>
          )}
          {/* beak */}
          <path d="M46 52 L54 52 L50 60 Z" fill="#fbbf24" />
          {/* glasses when thinking/reading */}
          {(local === "thinking" || local === "reading") && (
            <g stroke="#1e1b4b" strokeWidth="2" fill="none">
              <circle cx="40" cy="44" r="13" />
              <circle cx="60" cy="44" r="13" />
              <line x1="53" y1="44" x2="47" y2="44" />
            </g>
          )}
          {/* comforting sign */}
          {local === "comforting" && <text x="50" y="92" textAnchor="middle" fontSize="10">🤍</text>}
        </svg>
        {local === "celebrating" && (
          <span className="pointer-events-none absolute -right-1 -top-1 animate-ping text-lg">✨</span>
        )}
        {local === "sleeping" && (
          <span className="pointer-events-none absolute right-0 top-0 text-xs text-slate-400">z<sup>z</sup></span>
        )}
      </button>
    </div>
  );
}
