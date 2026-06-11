import React, { useEffect, useState } from "react";
import { Card, Spinner, Button } from "../../ui/components.jsx";
import { adminUsageApi } from "../../api/endpoints.js";
import {
  Zap, Coins, Cpu, IndianRupee, Gift, Save, Plus, RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
} from "recharts";

/**
 * Admin · AI usage & credit control. The ONLY surface where raw tokens and
 * ₹ cost are visible. Everything here is admin-editable without redeploys:
 * plans (limits + per-action weights), per-student plan + credit grants,
 * and provider model rates.
 */
export default function CreditsPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState(null);
  const [rates, setRates] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const [d, p, r] = await Promise.all([
      adminUsageApi.overview(days), adminUsageApi.plans(), adminUsageApi.modelRates(),
    ]);
    setData(d); setPlans(p); setRates(r);
  };
  useEffect(() => { load().catch(() => setMsg("Couldn't load usage data.")); }, [days]);

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(""), 2500); };

  const changePlan = async (userId, planKey) => {
    setBusyId(userId);
    try { await adminUsageApi.setUserPlan(userId, planKey); flash("Plan updated."); }
    catch { flash("Couldn't change the plan."); }
    finally { setBusyId(null); }
  };

  const grant = async (user) => {
    const amount = window.prompt(`Grant bonus credits to ${user?.name || "this student"} (raises this month's ceiling):`, "50");
    if (!amount || isNaN(Number(amount))) return;
    const reason = window.prompt("Reason (audit trail):", "Support top-up") || "";
    setBusyId(user?.id);
    try { await adminUsageApi.grantCredits(user.id, { amount: Number(amount), reason }); flash(`Granted ${amount} credits.`); }
    catch { flash("Grant failed."); }
    finally { setBusyId(null); }
  };

  if (!data || !plans) return <Spinner label="Loading usage & billing…" />;

  const t = data.totals || {};
  const fmt = (n) => Number(n || 0).toLocaleString("en-IN");
  const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">AI usage & credits</h1>
          <p className="text-slate-500">Raw tokens and ₹ cost are visible only here. Students and parents see credits.</p>
        </div>
        <div className="flex gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-xl px-3 py-1.5 text-sm font-extrabold ${days === d ? "bg-indigo-500 text-white" : "text-slate-500"}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="mt-3 rounded-2xl bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700">{msg}</p>}

      {/* Headline totals */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile icon={Zap} tint="indigo" label="AI calls" value={fmt(t.calls)} />
        <Tile icon={Cpu} tint="sky" label="Tokens" value={fmt(t.tokens)} />
        <Tile icon={Coins} tint="amber" label="Credits charged" value={fmt(t.credits)} />
        <Tile icon={IndianRupee} tint="rose" label="Cost" value={inr(t.cost_inr)} />
      </div>

      {/* Daily trend */}
      <Card className="mt-6 p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Daily tokens & cost</p>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.daily}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="tok" hide /><YAxis yAxisId="inr" orientation="right" hide />
              <Tooltip /><Legend />
              <Bar yAxisId="tok" dataKey="tokens" name="Tokens" fill="#a5b4fc" radius={[5, 5, 0, 0]} />
              <Line yAxisId="inr" type="monotone" dataKey="cost_inr" name="₹ cost" stroke="#f43f5e" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* By action */}
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Cost by action</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs font-extrabold uppercase tracking-wide text-slate-400">
              <tr><th className="py-2">Action</th><th>Calls</th><th>Tokens</th><th className="text-right">₹</th></tr>
            </thead>
            <tbody>
              {(data.by_action || []).map((a) => (
                <tr key={a.action_type} className="border-t border-slate-100">
                  <td className="py-2 font-extrabold capitalize text-slate-700">{a.action_type}</td>
                  <td>{fmt(a.calls)}</td><td>{fmt(a.tokens)}</td>
                  <td className="text-right font-bold">{inr(a.cost_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* By model */}
        <Card className="p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Cost by model</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs font-extrabold uppercase tracking-wide text-slate-400">
              <tr><th className="py-2">Model</th><th>Calls</th><th>Tokens</th><th className="text-right">₹</th></tr>
            </thead>
            <tbody>
              {(data.by_model || []).map((m) => (
                <tr key={m.model || "—"} className="border-t border-slate-100">
                  <td className="max-w-[180px] truncate py-2 font-extrabold text-slate-700">{m.model || "—"}</td>
                  <td>{fmt(m.calls)}</td><td>{fmt(m.tokens)}</td>
                  <td className="text-right font-bold">{inr(m.cost_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Per-student credit control */}
      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Top consumers — plan & top-ups</p>
          <button onClick={() => load()} className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-400 hover:text-indigo-600">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs font-extrabold uppercase tracking-wide text-slate-400">
            <tr><th className="py-2">Student</th><th>Calls</th><th>Credits</th><th>₹</th><th>Plan</th><th className="text-right">Top-up</th></tr>
          </thead>
          <tbody>
            {(data.top_students || []).map((s) => (
              <tr key={s.user_id} className="border-t border-slate-100">
                <td className="py-2.5">
                  <p className="font-extrabold text-slate-800">{s.user?.name || `#${s.user_id}`}</p>
                  <p className="text-xs text-slate-400">{s.user?.email}</p>
                </td>
                <td>{fmt(s.calls)}</td>
                <td>{fmt(s.credits)}</td>
                <td className="font-bold">{inr(s.cost_inr)}</td>
                <td>
                  <select
                    defaultValue=""
                    disabled={busyId === s.user_id}
                    onChange={(e) => e.target.value && changePlan(s.user_id, e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-extrabold outline-none"
                  >
                    <option value="" disabled>Set plan…</option>
                    {plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                  </select>
                </td>
                <td className="text-right">
                  <button
                    onClick={() => grant(s.user ?? { id: s.user_id })}
                    disabled={busyId === s.user_id}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700 hover:border-amber-300 disabled:opacity-50"
                  >
                    <Gift className="h-3.5 w-3.5" /> Grant
                  </button>
                </td>
              </tr>
            ))}
            {(data.top_students || []).length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-slate-400">No AI usage in this period yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Plan editor */}
      <p className="mt-8 text-sm font-extrabold uppercase tracking-wide text-slate-500">Plans (limits & per-action weights)</p>
      <div className="mt-3 grid gap-5 lg:grid-cols-3">
        {plans.map((p) => <PlanCard key={p.id} plan={p} onSaved={(np) => { setPlans((ps) => ps.map((x) => x.id === np.id ? np : x)); flash(`${np.name} saved.`); }} />)}
      </div>

      {/* Model rates */}
      <ModelRates rates={rates} onAdded={(r) => { setRates((rs) => [r, ...(rs || [])]); flash("Rate added."); }} />
    </>
  );
}

function Tile({ icon: Icon, tint, label, value }) {
  return (
    <Card className="p-4">
      <div className={`grid h-10 w-10 place-items-center rounded-2xl bg-${tint}-50 text-${tint}-600`}><Icon className="h-5 w-5" /></div>
      <p className="mt-3 text-2xl font-extrabold text-slate-900">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </Card>
  );
}

function PlanCard({ plan, onSaved }) {
  const [form, setForm] = useState({
    price_inr: plan.price_inr,
    daily_credit_limit: plan.daily_credit_limit,
    monthly_credit_limit: plan.monthly_credit_limit,
    per_action_weights: { ...(plan.per_action_weights || {}) },
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await adminUsageApi.updatePlan(plan.id, {
        price_inr: Number(form.price_inr) || 0,
        daily_credit_limit: Number(form.daily_credit_limit) || 0,
        monthly_credit_limit: Number(form.monthly_credit_limit) || 0,
        per_action_weights: Object.fromEntries(
          Object.entries(form.per_action_weights).map(([k, v]) => [k, Number(v) || 0])
        ),
      });
      onSaved(updated);
    } finally { setSaving(false); }
  };

  const num = (key, label) => (
    <label className="block">
      <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{label}</span>
      <input type="number" min="0" value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="mt-0.5 w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-extrabold outline-none focus:ring-2 focus:ring-indigo-200" />
    </label>
  );

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-lg font-extrabold text-slate-900">{plan.name}</p>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-600">{plan.key}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {num("price_inr", "₹ / month")}
        {num("daily_credit_limit", "Daily")}
        {num("monthly_credit_limit", "Monthly")}
      </div>
      <p className="mt-3 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Credit weight per action</p>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {Object.entries(form.per_action_weights).map(([action, w]) => (
          <label key={action} className="block">
            <span className="block truncate text-[10px] font-bold capitalize text-slate-400">{action}</span>
            <input type="number" min="0" step="0.5" value={w}
              onChange={(e) => setForm((f) => ({ ...f, per_action_weights: { ...f.per_action_weights, [action]: e.target.value } }))}
              className="mt-0.5 w-full rounded-xl border border-slate-200 px-2 py-1 text-sm font-extrabold outline-none focus:ring-2 focus:ring-indigo-200" />
          </label>
        ))}
      </div>
      <Button onClick={save} disabled={saving} className="mt-4 w-full">
        <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save plan"}
      </Button>
    </Card>
  );
}

function ModelRates({ rates, onAdded }) {
  const [form, setForm] = useState({ model: "", input_rate_per_1k: "", output_rate_per_1k: "" });
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (!form.model) return;
    setBusy(true);
    try {
      const r = await adminUsageApi.addModelRate({
        model: form.model,
        input_rate_per_1k: Number(form.input_rate_per_1k) || 0,
        output_rate_per_1k: Number(form.output_rate_per_1k) || 0,
        effective_from: new Date().toISOString(),
      });
      onAdded(r);
      setForm({ model: "", input_rate_per_1k: "", output_rate_per_1k: "" });
    } finally { setBusy(false); }
  };

  return (
    <Card className="mt-6 p-5">
      <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Model rates (₹ per 1K tokens)</p>
      <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
        <input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          placeholder="model id (e.g. gpt-4o-mini)"
          className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200" />
        <input value={form.input_rate_per_1k} onChange={(e) => setForm((f) => ({ ...f, input_rate_per_1k: e.target.value }))}
          type="number" step="0.001" min="0" placeholder="in ₹/1k"
          className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none" />
        <input value={form.output_rate_per_1k} onChange={(e) => setForm((f) => ({ ...f, output_rate_per_1k: e.target.value }))}
          type="number" step="0.001" min="0" placeholder="out ₹/1k"
          className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none" />
        <Button type="submit" disabled={busy}><Plus className="h-4 w-4" /> Add rate</Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {(rates || []).slice(0, 12).map((r) => (
          <span key={r.id} className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-extrabold text-slate-600 ring-1 ring-slate-200">
            {r.model} · in ₹{r.input_rate_per_1k} · out ₹{r.output_rate_per_1k}
          </span>
        ))}
      </div>
    </Card>
  );
}
