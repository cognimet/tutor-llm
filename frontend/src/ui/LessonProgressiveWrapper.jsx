import React, { useRef, useState } from "react";
import { ArrowDown } from "lucide-react";

/**
 * Progressive step-by-step reveal (Fancy Learning spec §4). Shows one card at a
 * time and a "Continue" button to reveal the next — lowering cognitive load so a
 * lesson reads like a paced story rather than a dumped wall of cards.
 */
export default function LessonProgressiveWrapper({ children }) {
  const cards = React.Children.toArray(children).filter(Boolean);
  const [visible, setVisible] = useState(1);
  const endRef = useRef(null);

  const next = () => {
    setVisible((v) => Math.min(cards.length, v + 1));
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
