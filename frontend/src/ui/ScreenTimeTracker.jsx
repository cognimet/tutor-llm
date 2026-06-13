import { useEffect, useRef } from "react";
import { telemetryApi } from "../api/endpoints.js";

/**
 * Passive screen-time tracker. Measures how long the student is ACTIVELY on the
 * current topic and reports it (topic_time telemetry → learner stage). Pauses
 * when the tab is hidden; flushes on topic change, unmount and tab hide. Renders
 * nothing. Trivial glances (< 3s) are ignored.
 */
export default function ScreenTimeTracker({ topicName, topicId }) {
  const topicRef = useRef({ topicName, topicId });
  topicRef.current = { topicName, topicId };

  const startRef = useRef(Date.now());
  const accumRef = useRef(0); // ms banked while visible
  const visibleRef = useRef(typeof document === "undefined" ? true : !document.hidden);
  const prevRef = useRef({ topicName, topicId });

  const bank = () => {
    if (visibleRef.current) {
      accumRef.current += Date.now() - startRef.current;
      startRef.current = Date.now();
    }
  };

  const flush = (topic) => {
    bank();
    const ms = Math.round(accumRef.current);
    accumRef.current = 0;
    startRef.current = Date.now();
    const t = topic || topicRef.current;
    if (ms >= 3000 && t.topicName) {
      telemetryApi.send([{ type: "topic_time", topic_name: t.topicName, topic_id: t.topicId, duration_ms: ms }]);
    }
  };

  // Pause/resume on tab visibility; flush on tab hide + unmount.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) { bank(); visibleRef.current = false; }
      else { visibleRef.current = true; startRef.current = Date.now(); }
    };
    const onHide = () => flush();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On topic switch, attribute the banked time to the PREVIOUS topic, then reset.
  useEffect(() => {
    const prev = prevRef.current;
    if (prev.topicName !== topicName || prev.topicId !== topicId) {
      flush(prev);
    }
    prevRef.current = { topicName, topicId };
    startRef.current = Date.now();
    accumRef.current = 0;
    visibleRef.current = typeof document === "undefined" ? true : !document.hidden;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicName, topicId]);

  return null;
}
