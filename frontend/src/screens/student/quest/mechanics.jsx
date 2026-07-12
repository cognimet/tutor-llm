/**
 * The hand-built game mechanics, ported from LearnQuest's vanilla-JS
 * renderers (`app/static/index.html`) to React.
 *
 * These are templates, not generated code: the AI only ever fills their content
 * contract. Each mechanic receives the *sanitized* params from the server
 * (GameInstance::forPlay strips every solution field) and calls `onSubmit(value)`
 * with whatever the child did. Grading happens on the server — nothing here knows
 * the answer, so nothing here can be cheated by reading the bundle.
 *
 * Contract: <Mechanic params={...} disabled={bool} onSubmit={(value) => void} />
 *
 * Look & feel: these render for children (below Class 9), so everything is a
 * chunky candy-colored "pressable" tile in the Baloo display font, popping in
 * with a springy stagger. The juice lives here and in index.css (`game-*`).
 */
import React, { useMemo, useState } from "react";

/* Chunky 3D primary button — the bottom border collapses on press. */
const BTN =
  "rounded-2xl border-b-4 border-indigo-800 bg-gradient-to-b from-indigo-500 to-indigo-600 px-6 py-3.5 font-display text-lg font-extrabold tracking-wide text-white shadow-lg transition-all hover:brightness-110 active:translate-y-0.5 active:border-b-2 disabled:cursor-not-allowed disabled:opacity-40";

/* Neutral chunky tile (steppers, reset, backspace). */
const TILE =
  "rounded-2xl border-2 border-b-4 border-slate-300 bg-white px-4 py-3 font-display text-lg font-extrabold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 active:translate-y-0.5 active:border-b-2 disabled:opacity-30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";

/* Candy palette — every class literal so Tailwind's scanner keeps them. */
const CANDY = [
  "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200",
  "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200",
  "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
  "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
  "border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200",
];

const candy = (i, picked = false) =>
  `game-pop rounded-2xl border-2 border-b-4 px-4 py-3 font-display text-lg font-extrabold shadow-sm transition-all hover:-translate-y-0.5 active:translate-y-0.5 active:border-b-2 disabled:opacity-40 ${
    CANDY[i % CANDY.length]
  } ${picked ? "ring-4 ring-indigo-300 dark:ring-indigo-500/50" : ""}`;

/* Springy staggered entrance for a row of tiles. */
const stagger = (i) => ({ animationDelay: `${i * 70}ms` });

const CHECK = "Check my answer ✨";

/* ------------------------------- number line ------------------------------ */
function NumberLine({ params, disabled, onSubmit }) {
  const { min = 0, max = 20, a, b, op } = params;
  const [val, setVal] = useState(Math.round((min + max) / 2));
  const [hops, setHops] = useState(0); // re-trigger the frog's hop on change
  const pct = ((val - min) / (max - min)) * 100;
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round(min + ((max - min) * i) / 5));
  const move = (v) => { setVal(v); setHops((h) => h + 1); };

  return (
    <div className="space-y-6">
      <p className="game-drop text-center font-display text-3xl font-extrabold tracking-tight text-slate-800 dark:text-slate-100">
        {a} {op} {b} = <span className="text-indigo-600 dark:text-indigo-400">{val}</span>
      </p>
      <p className="text-center text-sm font-bold text-slate-400">Hop the frog to the answer! 🪷</p>

      <div className="px-2">
        <div className="relative h-20">
          <div className="absolute top-9 h-3 w-full rounded-full bg-gradient-to-r from-sky-200 via-emerald-200 to-amber-200 dark:from-sky-900 dark:via-emerald-900 dark:to-amber-900" />
          <div key={hops} className="game-pop absolute top-1 text-4xl transition-all duration-200" style={{ left: `calc(${pct}% - 20px)` }}>
            🐸
          </div>
          {ticks.map((t, i) => (
            <span key={i} className="absolute top-14 -translate-x-1/2 font-display text-sm font-extrabold text-slate-400"
              style={{ left: `${(i / 5) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <input type="range" min={min} max={max} value={val} disabled={disabled}
          onChange={(e) => move(Number(e.target.value))}
          className="mt-2 w-full accent-indigo-600" aria-label="Move the frog to your answer" />
      </div>

      <div className="flex items-center justify-center gap-4">
        <button className={`${TILE} !px-6`} disabled={disabled} onClick={() => move(Math.max(min, val - 1))}>−1</button>
        <button className={`${TILE} !px-6`} disabled={disabled} onClick={() => move(Math.min(max, val + 1))}>+1</button>
      </div>
      <button className={`${BTN} w-full`} disabled={disabled} onClick={() => onSubmit(val)}>{CHECK}</button>
    </div>
  );
}

/* ------------------------------ build number ------------------------------ */
function BuildNumber({ disabled, onSubmit }) {
  const [st, setSt] = useState({ h: 0, t: 0, o: 0 });
  const total = st.h * 100 + st.t * 10 + st.o;
  const cols = [
    ["h", "Hundreds", "🟪", "bg-violet-500"],
    ["t", "Tens", "🟦", "bg-sky-500"],
    ["o", "Ones", "🟨", "bg-amber-500"],
  ];
  const bump = (k, d) => setSt((s) => ({ ...s, [k]: Math.max(0, Math.min(9, s[k] + d)) }));

  return (
    <div className="space-y-6">
      <p className="text-center text-sm font-bold text-slate-400">Stack the blocks to build the number! 🧱</p>
      <div className="grid grid-cols-3 gap-3">
        {cols.map(([k, label, emoji, tint], c) => (
          <div key={k} className="game-drop rounded-3xl border-2 border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800" style={stagger(c)}>
            <h4 className="mb-2 text-center font-display text-xs font-extrabold uppercase tracking-wide text-slate-500">
              {emoji} {label}
            </h4>
            <div className="flex min-h-24 flex-wrap content-start justify-center gap-1">
              {Array.from({ length: st[k] }, (_, i) => (
                <span key={i} className={`game-pop h-5 w-5 rounded-md ${tint}`} />
              ))}
            </div>
            <div className="mt-2 flex justify-center gap-2">
              <button className={`${TILE} !px-3 !py-1.5`} disabled={disabled} onClick={() => bump(k, -1)}>−</button>
              <button className={`${TILE} !px-3 !py-1.5`} disabled={disabled} onClick={() => bump(k, 1)}>+</button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-center font-display text-2xl font-extrabold text-slate-700 dark:text-slate-200">
        Total: <span key={total} className="game-pop inline-block text-indigo-600 dark:text-indigo-400">{total}</span>
      </p>
      <button className={`${BTN} w-full`} disabled={disabled} onClick={() => onSubmit(total)}>{CHECK}</button>
    </div>
  );
}

/* --------------------------------- compare -------------------------------- */
function Compare({ params, disabled, onSubmit }) {
  const { a, b } = params;
  const card = (i) =>
    `game-pop flex h-32 w-32 items-center justify-center rounded-[2rem] border-4 border-b-8 font-display text-5xl font-black shadow-lg transition-all hover:-translate-y-1 active:translate-y-0.5 active:border-b-4 disabled:opacity-50 ${CANDY[i]}`;

  return (
    <div className="space-y-6">
      <p className="text-center text-sm font-bold text-slate-400">The hungry alligator always eats the BIGGER number — tap it! 😋</p>
      <div className="flex items-center justify-center gap-4">
        <button className={card(1)} style={stagger(0)} disabled={disabled} onClick={() => onSubmit(">")}>{a}</button>
        <span className="animate-wiggle text-5xl">🐊</span>
        <button className={card(0)} style={stagger(1)} disabled={disabled} onClick={() => onSubmit("<")}>{b}</button>
      </div>
      <button className={`${TILE} mx-auto block`} disabled={disabled} onClick={() => onSubmit("=")}>
        They're twins! =
      </button>
    </div>
  );
}

/* ---------------------------------- pizza --------------------------------- */
function Pizza({ params, disabled, onSubmit }) {
  const parts = Math.max(2, params.parts || 2);
  const [sel, setSel] = useState(() => new Set());
  const R = 100, cx = 120, cy = 120;

  const slices = useMemo(
    () =>
      Array.from({ length: parts }, (_, i) => {
        const a0 = (i / parts) * 2 * Math.PI - Math.PI / 2;
        const a1 = ((i + 1) / parts) * 2 * Math.PI - Math.PI / 2;
        const [x0, y0] = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
        const [x1, y1] = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
        const large = a1 - a0 > Math.PI ? 1 : 0;
        return `M ${cx} ${cy} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
      }),
    [parts],
  );

  const toggle = (i) =>
    setSel((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <div className="space-y-5">
      <p className="text-center text-sm font-bold text-slate-400">Tap slices to add yummy sauce! 🍕</p>
      <svg viewBox="0 0 240 240" className="game-pop mx-auto h-56 w-56 drop-shadow-md">
        <circle cx={cx} cy={cy} r={R + 6} fill="#d97706" />
        <circle cx={cx} cy={cy} r={R} fill="#ffe08a" stroke="#e0932b" strokeWidth="3" />
        {slices.map((d, i) => (
          // role=button + tabIndex give keyboard users the same tap the mouse
          // gets — Enter/Space toggles the slice.
          <path key={i} d={d} stroke="#e0932b" strokeWidth="2"
            fill={sel.has(i) ? "#e0455e" : "transparent"}
            className={disabled ? "" : "cursor-pointer focus:outline-none focus-visible:stroke-indigo-600 focus-visible:stroke-[4]"}
            role="button" tabIndex={disabled ? -1 : 0}
            aria-label={`Slice ${i + 1}${sel.has(i) ? ", shaded" : ""}`} aria-pressed={sel.has(i)}
            onClick={() => !disabled && toggle(i)}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i); }
            }} />
        ))}
      </svg>
      <p className="text-center font-display text-lg font-extrabold text-slate-600 dark:text-slate-300">
        Saucy slices: <span key={sel.size} className="game-pop inline-block text-rose-500">{sel.size}</span>/{parts}
      </p>
      <button className={`${BTN} w-full`} disabled={disabled} onClick={() => onSubmit(sel.size)}>{CHECK}</button>
    </div>
  );
}

/* ------------------------------- word builder ----------------------------- */
function WordBuilder({ params, disabled, onSubmit }) {
  const letters = params.letters || [];
  const [used, setUsed] = useState([]); // indices into `letters`, in tap order
  const built = used.map((i) => letters[i]).join("");

  return (
    <div className="space-y-6">
      {params.emoji && <div className="game-bounce text-center text-7xl">{params.emoji}</div>}

      <div className="flex min-h-16 flex-wrap justify-center gap-2 rounded-3xl border-4 border-dashed border-indigo-200 p-3 dark:border-indigo-500/30">
        {used.length === 0 && <span className="self-center text-sm font-bold text-slate-400">Tap the letters to spell it! 🔤</span>}
        {used.map((i, pos) => (
          <span key={pos} style={stagger(0)}
            className={`game-pop flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-b-4 font-display text-2xl font-black uppercase ${CANDY[pos % CANDY.length]}`}>
            {letters[i]}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {letters.map((ch, i) => (
          <button key={i} style={stagger(i)}
            className={`${candy(i)} h-14 w-14 !p-0 text-2xl uppercase`}
            disabled={disabled || used.includes(i)}
            onClick={() => setUsed((u) => [...u, i])}>
            {ch}
          </button>
        ))}
      </div>

      <div className="flex justify-center gap-3">
        <button className={TILE} disabled={disabled || !used.length} onClick={() => setUsed((u) => u.slice(0, -1))}>⌫</button>
        <button className={BTN} disabled={disabled || !built} onClick={() => onSubmit(built)}>{CHECK}</button>
      </div>
    </div>
  );
}

/* -------------------------------- word match ------------------------------ */
function WordMatch({ params, disabled, onSubmit }) {
  const lefts = params.lefts || [];
  const rights = params.rights || [];
  const [selLeft, setSelLeft] = useState(null);
  const [pairs, setPairs] = useState({}); // left -> right

  const takenRights = new Set(Object.values(pairs));
  const done = Object.keys(pairs).length === lefts.length;

  // Each matched pair wears the same candy color — the child SEES the pairing.
  const colorOf = (left) => CANDY[lefts.indexOf(left) % CANDY.length];
  const ownerOf = (right) => Object.keys(pairs).find((l) => pairs[l] === right);

  const pickRight = (r) => {
    if (selLeft == null) return;
    setPairs((p) => ({ ...p, [selLeft]: r }));
    setSelLeft(null);
  };

  const base =
    "game-pop w-full rounded-2xl border-2 border-b-4 px-3 py-2.5 text-left font-display text-base font-extrabold shadow-sm transition-all active:translate-y-0.5 active:border-b-2 disabled:opacity-40";
  const idle = "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";

  return (
    <div className="space-y-5">
      <p className="text-center text-sm font-bold text-slate-400">Tap a word, then tap its best friend! 🤝</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {lefts.map((l, i) => (
            <button key={l} style={stagger(i)} disabled={disabled}
              className={`${base} ${l in pairs ? colorOf(l) : idle} ${selLeft === l ? "ring-4 ring-indigo-300 dark:ring-indigo-500/50" : ""}`}
              onClick={() => setSelLeft(selLeft === l ? null : l)}>
              {l}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {rights.map((r, i) => {
            const owner = ownerOf(r);
            return (
              <button key={r} style={stagger(i)}
                className={`${base} ${owner ? colorOf(owner) : idle}`}
                disabled={disabled || takenRights.has(r) || selLeft == null}
                onClick={() => pickRight(r)}>
                {r}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-center font-display text-sm font-extrabold text-slate-500">
        {Object.keys(pairs).length}/{lefts.length} matched {done ? "🎈" : ""}
      </p>
      <div className="flex justify-center gap-3">
        <button className={TILE} disabled={disabled || !Object.keys(pairs).length} onClick={() => { setPairs({}); setSelLeft(null); }}>
          Start over
        </button>
        <button className={BTN} disabled={disabled || !done} onClick={() => onSubmit(pairs)}>{CHECK}</button>
      </div>
    </div>
  );
}

/* -------------------------------- rhyme pick ------------------------------ */
function RhymePick({ params, disabled, onSubmit }) {
  const blobs = ["bg-rose-200", "bg-sky-200", "bg-emerald-200", "bg-amber-200", "bg-violet-200"];
  return (
    <div className="space-y-4">
      <p className="text-center text-sm font-bold text-slate-400">Pop the bubble that rhymes! 🫧</p>
      <div className="flex flex-wrap justify-center gap-4">
        {(params.options || []).map((o, i) => (
          <button key={o} style={stagger(i)} disabled={disabled} onClick={() => onSubmit(o)}
            className={`game-pop ${blobs[i % blobs.length]} h-28 w-28 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] font-display text-xl font-extrabold text-slate-700 shadow-lg transition-all hover:-translate-y-1.5 hover:rotate-3 active:translate-y-0.5 disabled:opacity-50`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- sort bucket ----------------------------- */
function SortBucket({ params, disabled, onSubmit }) {
  const bins = params.bins || [];
  const items = params.items || [];
  const [placed, setPlaced] = useState({}); // text -> bin
  const [sel, setSel] = useState(null);

  const pool = items.filter((t) => !(t in placed));
  const done = Object.keys(placed).length === items.length;
  const BIN_EMOJI = ["🧺", "🪣", "📦"];

  const drop = (bin) => {
    if (!sel) return;
    setPlaced((p) => ({ ...p, [sel]: bin }));
    setSel(null);
  };
  const lift = (text) =>
    setPlaced((p) => {
      const next = { ...p };
      delete next[text];
      return next;
    });

  return (
    <div className="space-y-5">
      <p className="text-center text-sm font-bold text-slate-400">Pick a sticker, then tap its home! 🏠</p>
      <div className="flex min-h-16 flex-wrap justify-center gap-2 rounded-3xl border-4 border-dashed border-slate-200 p-3 dark:border-slate-700">
        {pool.length === 0 && <span className="self-center text-sm font-bold text-slate-400">All sorted — check your answer! 🎈</span>}
        {pool.map((t, i) => (
          <button key={t} style={stagger(i)} disabled={disabled} onClick={() => setSel(sel === t ? null : t)}
            className={`${candy(items.indexOf(t), sel === t)} !py-2 !text-sm ${sel === t ? "game-bounce" : ""}`}>
            {t}
          </button>
        ))}
      </div>

      <div className={`grid gap-3 ${bins.length > 2 ? "grid-cols-3" : "grid-cols-2"}`}>
        {bins.map((bin, b) => (
          <div key={bin} onClick={() => !disabled && drop(bin)}
            className={`game-drop min-h-28 rounded-b-[2rem] rounded-t-2xl border-4 p-3 transition-all ${
              sel
                ? "-translate-y-0.5 cursor-pointer border-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10"
                : "border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/40"
            }`} style={stagger(b)}>
            <h4 className="mb-2 text-center font-display text-sm font-extrabold text-slate-600 dark:text-slate-300">
              {BIN_EMOJI[b % BIN_EMOJI.length]} {bin}
            </h4>
            <div className="flex flex-wrap justify-center gap-1">
              {Object.entries(placed).filter(([, v]) => v === bin).map(([t]) => (
                <button key={t} disabled={disabled} onClick={(e) => { e.stopPropagation(); lift(t); }}
                  className={`game-pop rounded-xl border-2 px-2 py-1 font-display text-xs font-extrabold shadow-sm ${CANDY[items.indexOf(t) % CANDY.length]}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button className={`${BTN} w-full`} disabled={disabled || !done} onClick={() => onSubmit(placed)}>{CHECK}</button>
    </div>
  );
}

/* ----------------------------- sentence builder --------------------------- */
function SentenceBuilder({ params, disabled, onSubmit }) {
  const tiles = params.tiles || [];
  const [chosen, setChosen] = useState([]); // indices into `tiles`
  const done = chosen.length === tiles.length;

  return (
    <div className="space-y-5">
      <p className="text-center text-sm font-bold text-slate-400">Build the sentence, one word at a time! 🚂</p>
      <div className="flex min-h-16 flex-wrap items-center justify-center gap-2 rounded-3xl border-4 border-dashed border-indigo-200 p-3 dark:border-indigo-500/30">
        {chosen.length === 0 && <span className="text-sm font-bold text-slate-400">Tap the words in order</span>}
        {chosen.map((i, pos) => (
          <button key={pos} disabled={disabled} className={`${candy(pos)} !py-2 !text-base`}
            onClick={() => setChosen((c) => c.filter((_, k) => k !== pos))}>
            {tiles[i]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {tiles.map((w, i) => (
          <button key={i} style={stagger(i)} className={`${TILE} !py-2 !text-base ${chosen.includes(i) ? "opacity-30" : "game-pop"}`}
            disabled={disabled || chosen.includes(i)}
            onClick={() => setChosen((c) => [...c, i])}>
            {w}
          </button>
        ))}
      </div>

      <button className={`${BTN} w-full`} disabled={disabled || !done}
        onClick={() => onSubmit(chosen.map((i) => tiles[i]).join(" "))}>
        {CHECK}
      </button>
    </div>
  );
}

/* -------------------------------- fill blank ------------------------------ */
function FillBlank({ params, disabled, onSubmit }) {
  const options = params.options || [];
  const [picked, setPicked] = useState(null);
  const parts = String(params.sentence || "").split("_____");

  return (
    <div className="space-y-6">
      {/* The real syllabus statement, told by the owl, with the blank inline. */}
      <div className="game-drop flex items-start gap-3">
        <span className="game-bounce mt-1 text-4xl">🦉</span>
        <p className="relative flex-1 rounded-3xl rounded-tl-md border-2 border-indigo-100 bg-indigo-50/70 p-4 text-left font-display text-lg font-bold leading-relaxed text-slate-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-slate-200">
          {parts[0]}
          <span className={`mx-1 inline-flex min-w-24 items-center justify-center rounded-xl border-2 border-dashed px-3 py-0.5 align-middle ${
            picked
              ? "game-pop border-indigo-400 bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
              : "game-blank-pulse border-slate-300 text-slate-300"
          }`}>
            {picked || "?"}
          </span>
          {parts.slice(1).join("_____")}
        </p>
      </div>
      <p className="text-center text-sm font-bold text-slate-400">Which word finishes the owl's sentence? 🧩</p>

      <div className="flex flex-wrap justify-center gap-2">
        {options.map((o, i) => (
          <button key={o} style={stagger(i)} className={`${candy(i, picked === o)} !text-base`}
            disabled={disabled} onClick={() => setPicked(o)}>
            {o}
          </button>
        ))}
      </div>

      <button className={`${BTN} w-full`} disabled={disabled || !picked} onClick={() => onSubmit(picked)}>
        {CHECK}
      </button>
    </div>
  );
}

/* -------------------------------- sequence -------------------------------- */
function Sequence({ params, disabled, onSubmit }) {
  const tiles = params.tiles || [];
  const [order, setOrder] = useState([]); // indices into `tiles`, in chosen order
  const done = order.length === tiles.length;
  // Rose (wrong) and emerald (correct) are the verdict colours, so the ordered
  // steps skip both — a red or green step reads as a mistake/success even when
  // it's just a neutral slot the child placed.
  const SEQ_TILE = [CANDY[1], CANDY[3], CANDY[4]]; // sky, amber, violet
  const BADGE = ["bg-sky-400", "bg-amber-400", "bg-violet-400"];

  return (
    <div className="space-y-5">
      <p className="text-center text-sm font-bold text-slate-400">Line up the steps like train cars — first to last! 🚂</p>

      {/* The ordered slots the student builds. */}
      <ol className="space-y-2">
        {order.map((i, pos) => (
          <li key={pos}>
            <button disabled={disabled} onClick={() => setOrder((o) => o.filter((_, k) => k !== pos))}
              className={`game-pop flex w-full items-center gap-3 rounded-2xl border-2 border-b-4 px-3 py-2.5 text-left font-display text-sm font-extrabold shadow-sm transition-all active:translate-y-0.5 active:border-b-2 ${SEQ_TILE[pos % SEQ_TILE.length]}`}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-sm font-black text-white shadow ${BADGE[pos % BADGE.length]}`}>
                {pos + 1}
              </span>
              {tiles[i]}
            </button>
          </li>
        ))}
        {order.length === 0 && (
          <li className="rounded-2xl border-4 border-dashed border-slate-200 p-4 text-center text-sm font-bold text-slate-400 dark:border-slate-700">
            Tap the first step to start your train! 🛤️
          </li>
        )}
      </ol>

      {/* Remaining scrambled steps. */}
      <div className="space-y-2">
        {tiles.map((step, i) =>
          order.includes(i) ? null : (
            <button key={i} style={stagger(i)} disabled={disabled} onClick={() => setOrder((o) => [...o, i])}
              className="game-pop flex w-full items-center gap-2 rounded-2xl border-2 border-b-4 border-slate-300 bg-white px-3 py-2.5 text-left font-display text-sm font-extrabold text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-400 active:translate-y-0.5 active:border-b-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <span className="text-slate-300">⋮⋮</span> {step}
            </button>
          ),
        )}
      </div>

      <button className={`${BTN} w-full`} disabled={disabled || !done} onClick={() => onSubmit(order.map((i) => tiles[i]))}>
        {CHECK}
      </button>
    </div>
  );
}

/* -------------------------------- pattern --------------------------------- */
// Learn-by-doing (not recall): the child SEES how the pattern grows — each jump
// between terms is drawn (+2, +2, +2) — so the rule is discovered by looking,
// then they extend it by tapping the next term. A child who didn't know the
// pattern beforehand learns it right here from the visible jumps.
function Pattern({ params, disabled, onSubmit }) {
  const terms = (params.terms || []).map(Number);
  const options = params.options || [];
  const [picked, setPicked] = useState(null);

  const fmt = (n) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);
  const jump = (d) => (d >= 0 ? `+${fmt(d)}` : `${fmt(d)}`);

  return (
    <div className="space-y-6">
      <p className="text-center text-sm font-bold text-slate-400">See how it grows… then add the next one! 🔍</p>

      {/* The pattern with each jump shown — this is the teaching. */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {terms.map((t, i) => (
          <React.Fragment key={i}>
            <span className="game-pop grid h-14 min-w-14 place-items-center rounded-2xl border-2 border-b-4 border-sky-300 bg-sky-100 px-2 font-display text-xl font-black text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200"
              style={stagger(i)}>
              {fmt(t)}
            </span>
            {i < terms.length - 1 && (
              <span className="flex flex-col items-center leading-none">
                <span className="text-[11px] font-black text-amber-500">{jump(terms[i + 1] - t)}</span>
                <span className="text-slate-300">→</span>
              </span>
            )}
          </React.Fragment>
        ))}
        {/* The unknown jump the child works out, then the slot they fill. */}
        <span className="flex flex-col items-center leading-none">
          <span className="game-blank-pulse text-[11px] font-black text-slate-400">?</span>
          <span className="text-slate-300">→</span>
        </span>
        <span className={`grid h-14 min-w-14 place-items-center rounded-2xl border-2 border-dashed px-2 font-display text-xl font-black ${
          picked != null
            ? "game-pop border-violet-400 bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
            : "game-blank-pulse border-slate-300 text-slate-300"
        }`}>
          {picked != null ? fmt(picked) : "?"}
        </span>
      </div>

      <p className="text-center text-sm font-bold text-slate-400">What number comes next? 🧩</p>
      <div className="flex flex-wrap justify-center gap-2">
        {options.map((o, i) => (
          <button key={i} style={stagger(i)} className={`${candy(i, picked === o)} !text-xl`}
            disabled={disabled} onClick={() => setPicked(o)}>
            {fmt(Number(o))}
          </button>
        ))}
      </div>

      <button className={`${BTN} w-full`} disabled={disabled || picked == null} onClick={() => onSubmit(picked)}>
        {CHECK}
      </button>
    </div>
  );
}

const REGISTRY = {
  number_line: NumberLine,
  build_number: BuildNumber,
  compare: Compare,
  pizza: Pizza,
  word_builder: WordBuilder,
  word_match: WordMatch,
  rhyme_pick: RhymePick,
  sort_bucket: SortBucket,
  sentence_builder: SentenceBuilder,
  fill_blank: FillBlank,
  sequence: Sequence,
  pattern: Pattern,
};

/** Dispatches on `params.kind`. Remounts per item so each starts clean. */
export default function Mechanic({ params = {}, disabled = false, onSubmit }) {
  const Component = REGISTRY[params.kind];
  if (!Component) {
    return <p className="text-center text-sm text-rose-500">This game type isn't available yet.</p>;
  }
  return <Component params={params} disabled={disabled} onSubmit={onSubmit} />;
}

export { REGISTRY };
