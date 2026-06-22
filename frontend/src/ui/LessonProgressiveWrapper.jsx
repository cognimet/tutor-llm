import React, { useRef, useState, useEffect } from "react";
import { ArrowDown } from "lucide-react";
import { tutorApi } from "../api/endpoints.js";

/**
 * Progressive step-by-step reveal (Fancy Learning spec §4). Shows one card at a
 * time with a "Continue" button to reveal the next — lowering cognitive load so a
 * lesson reads like a paced story rather than a dumped wall of cards.
 *
 * The revealed count is DURABLE: each "continue" click is logged to the session
 * (read_continue), and on load the wrapper opens to 1 + the number of logged
 * clicks — so revealed cards stay open across refresh / leaving the chat.
 */
export default function LessonProgressiveWrapper({ children, targetId, sessionId, historicalLogs = [], onLogUpdate }) {
  const cards = React.Children.toArray(children).filter(Boolean);

  // Visible = 1 (the first card) + however many "continue" clicks were logged.
  const [visible, setVisible] = useState(() => Math.min(cards.length, historicalLogs.length + 1));
  const endRef = useRef(null);

  // Hydrate when logs arrive later — only ever reveal MORE, never collapse what
  // the student already opened optimistically (guards against log round-trip lag).
  useEffect(() => {
    const revealed = Math.min(cards.length, historicalLogs.length + 1);
    setVisible((v) => Math.max(v, revealed));
  }, [historicalLogs.length, cards.length]);

  const next = () => {
    if (visible >= cards.length) return;
    const nextIdx = visible;          // 0-based index of the card we're revealing
    setVisible(nextIdx + 1);          // reveal immediately (don't wait on the network)

    if (sessionId && targetId) {
      const log = {
        type: "read_continue",
        target_id: targetId,
        metadata: { card_index: nextIdx, card_title: cards[nextIdx]?.props?.title || "" },
      };
      tutorApi.logProgress(sessionId, log).catch(() => { /* non-blocking */ });
      onLogUpdate?.(log);             // keep the session's log list in sync
    }

    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  return (
    <div className="space-y-3">
      {cards.slice(0, visible).map((card, idx) => (
        <div key={idx} className="animate-slide-up">{card}</div>
      ))}
      <div ref={endRef} />
      {visible < cards.length && (
        <div className="flex justify-center py-1">
          <button
            onClick={next}
            className="flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg transition-transform active:scale-95"
          >
            <span>Got it! Continue · {visible}/{cards.length}</span>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
