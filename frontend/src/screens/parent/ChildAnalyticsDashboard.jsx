import React, { useEffect, useState } from "react";
import { LineChart } from "lucide-react";
import { Spinner } from "../../ui/components.jsx";
import { DayToggle, Hero } from "../../ui/analytics/AnalyticsKit.jsx";
import AnalyticsView from "../../ui/analytics/AnalyticsView.jsx";
import { parentApi, parentAnalyticsApi } from "../../api/endpoints.js";

/**
 * Parent · child analytics. Same insight engine as the student view, framed for
 * a parent with recommended interventions. Pick a child, pick a window.
 */
export default function ChildAnalyticsDashboard() {
  const [children, setChildren] = useState(null);
  const [childId, setChildId] = useState(null);
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    parentApi.children()
      .then((cs) => { setChildren(cs); if (cs?.length) setChildId(cs[0].id); })
      .catch(() => setErr("Couldn't load your children."));
  }, []);

  useEffect(() => {
    if (!childId) return;
    let on = true;
    setData(null); setErr("");
    parentAnalyticsApi.analytics(childId, days)
      .then((d) => on && setData(d))
      .catch(() => on && setErr("Couldn't load analytics for this child."));
    return () => { on = false; };
  }, [childId, days]);

  if (children && !children.length) {
    return <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">Link a child to see their insights.</p>;
  }

  return (
    <>
      <Hero icon={LineChart} title="Child insights"
        subtitle="Performance, focus, gaps and what to do next."
        right={
          <>
            {children && children.length > 1 && (
              <select value={childId ?? ""} onChange={(e) => setChildId(Number(e.target.value))}
                className="rounded-2xl bg-white/20 px-3 py-2 text-sm font-bold text-white [&>option]:text-slate-700">
                {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <DayToggle days={days} setDays={setDays} onGradient />
          </>
        } />

      <div className="mt-6">
        {err ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{err}</p>
          : !data ? <Spinner label="Loading child insights…" />
          : <AnalyticsView data={data} audience="parent" />}
      </div>
    </>
  );
}
