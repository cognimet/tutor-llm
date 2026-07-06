import { useCallback, useEffect, useMemo, useRef } from "react";
import { analyticsApi } from "../api/endpoints.js";

/**
 * Captures engagement + integrity telemetry during an assessment (or lesson):
 *
 *   - tab_blur / tab_focus   — visibilitychange + window blur/focus, with the
 *                              away-duration, so we can flag focus-loss and score
 *                              assessment integrity.
 *   - question_view          — per-question dwell time (logged on the NEXT view).
 *   - answer_change          — every change of a selected option before submit.
 *   - assessment_start/submit/drop_off — completion + drop-off funnel.
 *   - confidence             — optional self-reported confidence per question.
 *
 * Events are queued and flushed in batches (interval + on page-hide), so this
 * never blocks the UI and survives a tab closing mid-assessment.
 *
 * Usage:
 *   const t = useEngagementTracker({ assessmentId });
 *   useEffect(() => t.start(), []);
 *   onView:   t.questionView(qId)
 *   onChange: t.answerChange(qId, fromIdx, toIdx)
 *   onSubmit: t.submit()
 */
export function useEngagementTracker({ assessmentId = null, chatSessionId = null, enabled = true, dropOff = true } = {}) {
  const queue = useRef([]);
  const ctx = useRef({ assessmentId, chatSessionId });
  ctx.current = { assessmentId, chatSessionId };

  // Per-question dwell + tab-away timers.
  const viewedAt = useRef(0);
  const currentQ = useRef(null);
  const blurAt = useRef(0);
  const submitted = useRef(false);

  const enqueue = useCallback((type, extra = {}) => {
    if (!enabled) return;
    queue.current.push({
      type,
      assessment_id: ctx.current.assessmentId ?? undefined,
      chat_session_id: ctx.current.chatSessionId ?? undefined,
      ts: Date.now(),
      ...extra,
    });
  }, [enabled]);

  const flush = useCallback((sync = false) => {
    if (!queue.current.length) return;
    const batch = queue.current.splice(0, queue.current.length);
    // ingest() uses sendBeacon where possible for sync (page-hide) flushes.
    analyticsApi.ingest(batch);
    void sync;
  }, []);

  /* ----- public actions ----- */

  const start = useCallback(() => { submitted.current = false; enqueue("assessment_start"); }, [enqueue]);

  const questionView = useCallback((questionId) => {
    const now = Date.now();
    // Close out the previous question's dwell.
    if (currentQ.current != null && viewedAt.current) {
      enqueue("question_view", { question_id: currentQ.current, duration_ms: now - viewedAt.current });
    }
    currentQ.current = questionId ?? null;
    viewedAt.current = now;
  }, [enqueue]);

  const answerChange = useCallback((questionId, fromIdx, toIdx) => {
    enqueue("answer_change", { question_id: questionId ?? undefined, meta: { from_idx: fromIdx, to_idx: toIdx } });
  }, [enqueue]);

  const confidence = useCallback((questionId, value) => {
    enqueue("confidence", { question_id: questionId ?? undefined, meta: { confidence: value } });
  }, [enqueue]);

  const submit = useCallback(() => {
    // Final question dwell.
    if (currentQ.current != null && viewedAt.current) {
      enqueue("question_view", { question_id: currentQ.current, duration_ms: Date.now() - viewedAt.current });
      viewedAt.current = 0; currentQ.current = null;
    }
    submitted.current = true;
    enqueue("assessment_submit");
    flush();
  }, [enqueue, flush]);

  /* ----- focus / visibility integrity ----- */

  useEffect(() => {
    if (!enabled) return undefined;

    const onHide = () => {
      if (blurAt.current) return;
      blurAt.current = Date.now();
      enqueue("tab_blur");
      flush(); // post immediately — the user may not return to this tab
    };
    const onShow = () => {
      if (!blurAt.current) return;
      enqueue("tab_focus", { duration_ms: Date.now() - blurAt.current });
      blurAt.current = 0;
    };
    const onVisibility = () => (document.hidden ? onHide() : onShow());
    const onPageHide = () => {
      // Leaving with an open assessment that was never submitted = drop-off.
      // (Disabled for the global app-wide tracker, where every page-close would
      // otherwise look like a drop-off.)
      if (dropOff && !submitted.current) enqueue("drop_off");
      flush(true);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onHide);
    window.addEventListener("focus", onShow);
    window.addEventListener("pagehide", onPageHide);
    const interval = setInterval(() => flush(), 10000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onHide);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(interval);
      flush(true);
    };
  }, [enabled, dropOff, enqueue, flush]);

  return useMemo(
    () => ({ start, questionView, answerChange, confidence, submit, flush }),
    [start, questionView, answerChange, confidence, submit, flush],
  );
}

export default useEngagementTracker;
