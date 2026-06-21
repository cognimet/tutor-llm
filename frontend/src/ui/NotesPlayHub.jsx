import React, { useEffect, useMemo, useState } from "react";
import { Sparkles, RotateCcw, Check, RefreshCw, Calculator, Layers, Loader2 } from "lucide-react";
import { notesApi } from "../api/endpoints.js";

/**
 * The Play Hub (spec §4.4 / §5.4.3): micro-learning games generated from the
 * student's own uploaded notes. Two modes:
 *  - Flashcards: tap-to-flip recall deck with "Got it 👍 / Review 🔁" sorting.
 *  - Formula Board: every formula/term from the notes as a quick cheat sheet.
 *
 * Props: noteId (the active auto-scoped note). Renders inside the sidebar.
 */
export default function NotesPlayHub({ noteId }) {
  const [tab, setTab] = useState("cards");
  const [cards, setCards] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    if (!noteId) { setCards([]); return undefined; }
    setCards(null); setError("");
    notesApi.flashcards(noteId)
      .then((cs) => { if (alive) setCards(Array.isArray(cs) ? cs : []); })
      .catch(() => { if (alive) { setCards([]); setError("Couldn't load your cards yet."); } });
    return () => { alive = false; };
  }, [noteId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-white/5">
        {[["cards", "Flashcards", Layers], ["formulas", "Formula Board", Calculator]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition-colors ${
              tab === id ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-800 dark:text-indigo-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {!noteId ? (
        <Empty>Snap or drop a note first — your flashcards and formulas appear here ✨</Empty>
      ) : cards === null ? (
        <Empty><Loader2 className="h-4 w-4 animate-spin text-indigo-400" /> Building your games…</Empty>
      ) : cards.length === 0 ? (
        <Empty>{error || "No cards from this note yet — they generate as the note is processed."}</Empty>
      ) : tab === "cards" ? (
        <FlashcardDeck cards={cards} />
      ) : (
        <FormulaBoard cards={cards} />
      )}
    </div>
  );
}

const Empty = ({ children }) => (
  <div className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs font-semibold text-slate-400 dark:border-white/10">
    {children}
  </div>
);

/* ---------------------------------------------------- flashcard swipe deck */

function FlashcardDeck({ cards }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [got, setGot] = useState(0);

  const idx = order[pos];
  const card = cards[idx];
  const done = pos >= order.length;

  const next = (knewIt) => {
    if (knewIt) setGot((g) => g + 1);
    setFlipped(false);
    setPos((p) => p + 1);
  };
  const restart = () => { setOrder(cards.map((_, i) => i)); setPos(0); setGot(0); setFlipped(false); };

  if (done) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-slate-50 p-6 text-center dark:bg-white/5">
        <Sparkles className="h-7 w-7 text-indigo-500" />
        <p className="font-extrabold text-slate-800 dark:text-white">Deck complete!</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">You knew <b>{got}</b> of {cards.length} cards.</p>
        <button onClick={restart} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-extrabold text-white">
          <RotateCcw className="h-4 w-4" /> Shuffle again
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-slate-400">
        <span>Card {pos + 1} / {order.length}</span>
        <span>Known: {got}</span>
      </div>
      <button onClick={() => setFlipped((f) => !f)}
        className="flex min-h-[9rem] flex-1 flex-col items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-sm transition-all active:scale-[0.99] dark:border-white/10 dark:bg-slate-800">
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-indigo-400">{flipped ? "Answer" : "Tap to flip"}</span>
        <span className="text-base font-bold leading-snug text-slate-800 dark:text-slate-100">
          {flipped ? card.definition : card.term}
        </span>
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => next(false)}
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 py-2.5 text-sm font-extrabold text-slate-600 hover:border-amber-300 hover:text-amber-600 dark:border-white/10 dark:text-slate-300">
          <RefreshCw className="h-4 w-4" /> Review again
        </button>
        <button onClick={() => next(true)}
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-500 py-2.5 text-sm font-extrabold text-white active:scale-[0.98]">
          <Check className="h-4 w-4" /> Got it
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ formula board */

const looksLikeFormula = (s) => /[=√^±×÷+\-*/]|\b\d/.test(String(s || ""));

function FormulaBoard({ cards }) {
  const formulas = useMemo(
    () => cards.filter((c) => looksLikeFormula(c.term) || looksLikeFormula(c.definition)),
    [cards]);
  const list = formulas.length ? formulas : cards;

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
      {!formulas.length && (
        <p className="px-1 pb-1 text-[11px] font-semibold text-slate-400">No formulas detected — showing key terms.</p>
      )}
      {list.map((c) => (
        <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-800">
          <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{c.term}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{c.definition}</p>
        </div>
      ))}
    </div>
  );
}
