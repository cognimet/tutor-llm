import React, { useCallback, useEffect, useState } from "react";
import { usageApi } from "../api/endpoints.js";

/**
 * Student credit meter — shows daily AI credits as a friendly bar.
 * Students see CREDITS, never raw tokens. Refreshes itself when any AI call
 * completes or hits the quota wall (the `usage:refresh` window event, fired
 * by the api client/stream on 402) and on a slow poll as a fallback.
 */
export default function CreditMeter({ className = "" }) {
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

  const { used, limit, remaining } = usage.daily;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const low = remaining <= Math.max(3, limit * 0.1);
  const out = remaining <= 0;

  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs
        ${out ? "border-rose-200 bg-rose-50 text-rose-700"
              : low ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300"} ${className}`}
      title={`Daily learning energy — resets at midnight. Plan: ${usage.plan.name}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
      <span className="font-medium">
        {out ? "Out of credits today" : `${Math.round(remaining)} credits left`}
      </span>
      <span className="hidden sm:block h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <span
          className={`block h-full rounded-full ${out ? "bg-rose-400" : low ? "bg-amber-400" : "bg-indigo-400"}`}
          style={{ width: `${100 - pct}%` }}
        />
      </span>
    </div>
  );
}
