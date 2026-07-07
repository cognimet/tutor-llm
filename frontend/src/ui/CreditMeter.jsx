import React, { useCallback, useEffect, useState } from "react";
import { usageApi } from "../api/endpoints.js";

/**
 * Student credit meter — a friendly "learning energy" bar. Students see CREDITS
 * (never raw tokens or ₹). Clicking opens the plans screen (onUpgrade). Shows a
 * live reset countdown so the daily refill is expected, and turns into an
 * "Upgrade" call-to-action when the day's credits run out.
 */
export default function CreditMeter({ className = "", onUpgrade }) {
  const [usage, setUsage] = useState(null);

  const load = useCallback(async () => {
    try { setUsage(await usageApi.me()); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("usage:refresh", onRefresh);
    const t = setInterval(load, 60_000);
    return () => { window.removeEventListener("usage:refresh", onRefresh); clearInterval(t); };
  }, [load]);

  if (!usage) return null;

  const { used, limit, remaining, resets } = usage.daily;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const low = remaining <= Math.max(3, limit * 0.1);
  const out = remaining <= 0;
  const clickable = typeof onUpgrade === "function";

  const tooltip =
    `Daily learning energy — ${resetLabel(resets)}.`
    + `\nMonthly: ${Math.round(usage.monthly.remaining)} of ${usage.monthly.limit} left.`
    + `\nPlan: ${usage.plan.name}` + (clickable ? " · tap to see plans" : "");

  // Out of credits → an upgrade call-to-action instead of a dead red pill.
  if (out && clickable) {
    return (
      <button onClick={onUpgrade} title={tooltip}
        className={`inline-flex items-center gap-1.5 rounded-full bg-indigo-500 px-3 py-1.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-indigo-600 ${className}`}>
        <Bolt /> Out for today — Upgrade
      </button>
    );
  }

  const Wrapper = clickable ? "button" : "div";

  return (
    <Wrapper
      {...(clickable ? { onClick: onUpgrade, type: "button" } : {})}
      title={tooltip}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition
        ${out ? "border-rose-200 bg-rose-50 text-rose-700"
              : low ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300"}
        ${clickable ? "hover:ring-1 hover:ring-indigo-300 cursor-pointer" : ""} ${className}`}
    >
      <Bolt />
      <span className="font-medium">
        {out ? "Out of credits today" : `${Math.round(remaining)} credits left`}
      </span>
      <span className="hidden sm:block h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <span
          className={`block h-full rounded-full ${out ? "bg-rose-400" : low ? "bg-amber-400" : "bg-indigo-400"}`}
          style={{ width: `${100 - pct}%` }}
        />
      </span>
      <span className="hidden text-[10px] font-bold uppercase tracking-wide opacity-60 md:inline">{resetLabel(resets)}</span>
    </Wrapper>
  );
}

const Bolt = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

/** "resets in 6h" / "resets in 40m" from an ISO end-of-day timestamp. */
function resetLabel(resets) {
  if (!resets) return "resets at midnight";
  const ms = new Date(resets).getTime() - Date.now();
  if (ms <= 0) return "resetting…";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  return `resets in ${Math.round(mins / 60)}h`;
}
