/**
 * The "you're out of credits" call-to-action.
 *
 * Shown wherever an AI action is blocked by the quota gate (HTTP 402). It carries
 * the friendly message from the backend and a button that takes the student
 * straight to the Plans screen to upgrade — so a dead end becomes a conversion.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Coins } from "lucide-react";

/** True when an axios error (or a raw payload) is a credit-quota block. */
export function isQuotaError(err) {
  const res = err?.response;
  return res?.status === 402 || res?.data?.error === "quota_exceeded" || err?.quota === true;
}

/** Pull the human message out of a 402 payload, with a sensible default. */
export function quotaMessage(err) {
  return (
    err?.response?.data?.message ||
    err?.message ||
    "You've used today's AI learning credits. Upgrade to keep learning."
  );
}

export default function UpgradeCTA({
  message = "You've used today's AI learning credits.",
  onNavigate,          // optional: called just before navigating (e.g. to close a modal)
  className = "",
  compact = false,
}) {
  const navigate = useNavigate();
  const goToPlans = () => {
    onNavigate?.();
    navigate("/plans");
  };

  if (compact) {
    // Inline form for chat bubbles / tight spaces.
    return (
      <div className={`flex flex-wrap items-center gap-3 ${className}`}>
        <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{message}</span>
        <button
          onClick={goToPlans}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-extrabold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-indigo-700"
        >
          <Sparkles className="h-4 w-4" /> Upgrade
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-4 py-4 text-center ${className}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-500/15">
        <Coins className="h-6 w-6 text-amber-500" />
      </div>
      <div>
        <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100">Out of credits for today</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm font-semibold text-slate-500">{message}</p>
      </div>
      <button
        onClick={goToPlans}
        className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-sm font-extrabold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-indigo-700"
      >
        <Sparkles className="h-4 w-4" /> See plans &amp; upgrade
      </button>
      <p className="text-xs text-slate-400">Credits also refresh tomorrow.</p>
    </div>
  );
}
