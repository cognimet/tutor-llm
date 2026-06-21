import { useCallback, useRef } from "react";

/**
 * Tiny WebAudio sound engine for the gamification module (spec §4.2). Synthesises
 * the soundscape on the fly (no asset files): star shimmer, magic pop, retro
 * level-up arpeggio, and a streak whoosh. Respects a muted flag and degrades
 * silently where WebAudio is unavailable.
 */
export default function useGameSound(enabled = true) {
  const ctxRef = useRef(null);

  const ctx = () => {
    if (!enabled) return null;
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
    }
    if (ctxRef.current.state === "suspended") ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  };

  const tone = (ac, freq, start, dur, type = "sine", gain = 0.15) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime + start);
    g.gain.setValueAtTime(0.0001, ac.currentTime + start);
    g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(ac.currentTime + start);
    osc.stop(ac.currentTime + start + dur + 0.05);
  };

  const play = useCallback((name) => {
    const ac = ctx();
    if (!ac) return;
    switch (name) {
      case "star":        // whimsical sparkle sweep
        [880, 1175, 1568].forEach((f, i) => tone(ac, f, i * 0.05, 0.18, "triangle", 0.12));
        break;
      case "pop":         // bubble pop + chime
        tone(ac, 660, 0, 0.08, "sine", 0.18);
        tone(ac, 990, 0.06, 0.14, "triangle", 0.12);
        break;
      case "levelup":     // 8-bit major arpeggio C-E-G-C
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, f, i * 0.09, 0.22, "square", 0.1));
        break;
      case "streak":      // fire whoosh + clink
        tone(ac, 220, 0, 0.25, "sawtooth", 0.08);
        tone(ac, 1320, 0.22, 0.12, "triangle", 0.1);
        break;
      default:
        break;
    }
  }, [enabled]);

  return play;
}
