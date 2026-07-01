import React, { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Spinner } from "../../ui/components.jsx";
import { DayToggle, Hero } from "../../ui/analytics/AnalyticsKit.jsx";
import AnalyticsView from "../../ui/analytics/AnalyticsView.jsx";
import { analyticsApi } from "../../api/endpoints.js";

/**
 * Student · personal analytics. Gap analysis, strengths/weaknesses, attention &
 * integrity, progress over time, and an action plan — all from /me/analytics.
 */
export default function UserAnalyticsDashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    setData(null); setErr("");
    analyticsApi.me(days)
      .then((d) => on && setData(d))
      .catch(() => on && setErr("Couldn't load your analytics."));
    return () => { on = false; };
  }, [days]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 pb-32">
      <Hero icon={Sparkles} title="My insights"
        subtitle="Where you're strong, where to focus, and how you're trending."
        right={<DayToggle days={days} setDays={setDays} onGradient />} />

      <div className="mt-6">
        {err ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{err}</p>
          : !data ? <Spinner label="Crunching your insights…" />
          : <AnalyticsView data={data} audience="student" />}
      </div>
    </div>
  );
}
