import React, { useEffect, useState } from "react";
import { Card, Button, Spinner } from "../../ui/components.jsx";
import { billingApi, usageApi } from "../../api/endpoints.js";
import { ArrowLeft, Check, Sparkles, Users, Crown, Zap, Activity, Coins } from "lucide-react";

const apiError = (err, fallback) =>
  err.response?.data?.message
  || Object.values(err.response?.data?.errors || {})[0]?.[0]
  || fallback;

const ICON = { free: Zap, plus: Crown, family: Users };

export default function PlansScreen({ onBack }) {
  const [data, setData] = useState(null);
  const [usage, setUsage] = useState(null);  // student's own usage (parents have none)
  const [period, setPeriod] = useState("month");
  const [busy, setBusy] = useState("");
  const [payFor, setPayFor] = useState(null); // plan being purchased (opens pay modal)
  const [msg, setMsg] = useState(null);      // { type:'ok'|'err', text }

  const load = () => billingApi.plans().then(setData);
  const loadUsage = () => usageApi.detail().then(setUsage).catch(() => setUsage(null));
  useEffect(() => { load(); loadUsage(); }, []);

  if (!data) return <Spinner label="Loading plans…" />;

  const byKey = Object.fromEntries(data.plans.map((p) => [p.key, p]));
  const roots = ["free", "plus", "family"];
  const cardFor = (root) => {
    const monthly = byKey[root];
    const annual = byKey[`${root}_annual`];
    return period === "year" && annual ? { ...annual, monthly } : monthly;
  };
  const cards = roots.map(cardFor).filter(Boolean);

  // Called by the pay modal once a payment is confirmed & activated.
  const onPaid = async (plan) => {
    setPayFor(null);
    window.dispatchEvent(new Event("usage:refresh"));
    setMsg({ type: "ok", text: `You're on ${plan.name.replace(" (annual)", "")}. Your new limits are active.` });
    await load(); await loadUsage();
  };

  const cancel = async () => {
    if (!confirm("Cancel your subscription? You keep access until the end of the current period.")) return;
    setBusy("cancel"); setMsg(null);
    try {
      await billingApi.cancel();
      setMsg({ type: "ok", text: "Subscription set to cancel at period end." });
      await load();
    } catch (err) {
      setMsg({ type: "err", text: apiError(err, "Could not cancel.") });
    } finally { setBusy(""); }
  };

  const sub = data.subscription;

  return (
    <div className="mx-auto max-w-4xl">
      {onBack && (
        <button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 dark:text-slate-400 hover:text-indigo-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}

      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Choose your plan</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">Simple pricing. Upgrade or cancel anytime.</p>
      </div>

      {/* Monthly / Annual toggle */}
      <div className="mt-5 flex justify-center">
        <div className="inline-flex gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-white/10">
          {[["month", "Monthly"], ["year", "Annual · save ~33%"]].map(([id, label]) => (
            <button key={id} onClick={() => setPeriod(id)}
              className={`rounded-xl px-4 py-2 text-sm font-extrabold ${period === id ? "bg-indigo-500 text-white" : "text-slate-500 dark:text-slate-400"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className={`mt-5 rounded-2xl p-3 text-center text-sm font-bold ring-1 ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-rose-50 text-rose-700 ring-rose-100"}`}>
          {msg.text}
        </div>
      )}

      {usage && <UsagePanel usage={usage} />}

      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        {cards.map((p) => {
          const root = p.key.replace("_annual", "");
          const Icon = ICON[root] || Sparkles;
          const featured = root === "plus";
          const perMonth = p.billing_period === "year" ? Math.round(p.price_inr / 12) : p.price_inr;
          const badgeTone = p.savings_pct ? "bg-emerald-500" : "bg-indigo-500";
          const name = p.name.replace(" (annual)", "");
          return (
            <Card key={p.key} className={`relative flex flex-col p-6 ${featured ? "ring-2 ring-indigo-400 shadow-xl shadow-indigo-500/10" : ""}`}>
              {p.badge && <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full ${badgeTone} px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white`}>{p.badge}</span>}

              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Icon className="h-6 w-6" /></div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-lg font-extrabold text-slate-900 dark:text-white">{name}</p>
                {p.best_for && <span className="rounded-full bg-slate-100 dark:bg-white/10 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">{p.best_for}</span>}
              </div>
              {p.tagline && <p className="text-xs text-slate-400">{p.tagline}</p>}

              <p className="mt-2">
                <span className="text-3xl font-extrabold text-slate-900 dark:text-white">₹{perMonth}</span>
                <span className="text-sm text-slate-400">/mo</span>
              </p>
              <p className="text-[11px] text-slate-400">
                {p.billing_period === "year" ? `₹${p.price_inr} billed yearly${p.savings_pct ? ` · save ${p.savings_pct}%` : ""}`
                  : p.price_inr === 0 ? "Free forever · no card" : "billed monthly"}
              </p>
              {p.vs_free ? <span className="mt-2 inline-block rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-extrabold text-indigo-600">{p.vs_free}× more usage than Free</span> : null}

              <ul className="mt-4 space-y-2">
                {(p.highlights || []).map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-5">
                <div className="mb-3 rounded-xl bg-slate-50 dark:bg-white/5 px-3 py-2 text-center text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  {p.daily_credits} credits/day · {p.monthly_credits.toLocaleString()}/month
                </div>
                {p.is_current ? (
                  <div className="rounded-2xl bg-slate-100 dark:bg-white/5 py-2.5 text-center text-sm font-extrabold text-slate-500 dark:text-slate-400">Current plan</div>
                ) : p.price_inr === 0 ? (
                  <div className="py-2.5 text-center text-xs text-slate-400">Included by default</div>
                ) : (
                  <Button className="w-full justify-center" onClick={() => setPayFor(p)}>
                    Choose {name}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Trust bar */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[11px] font-bold text-slate-400">
        <span>✓ Cancel anytime</span>
        <span>✓ Secure UPI & cards</span>
        <span>✓ GST invoice</span>
        <span>✓ Instant activation</span>
      </div>

      {/* What uses a credit */}
      {data.credit_costs?.length > 0 && <CreditCosts costs={data.credit_costs} />}

      {/* Current subscription + cancel */}
      {sub && sub.plan?.price_inr > 0 && (
        <Card className="mt-6 flex flex-col items-center justify-between gap-3 p-5 sm:flex-row">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-extrabold text-slate-900 dark:text-white">{sub.plan.name}</span> · {sub.status}
            {sub.cancel_at ? " · cancels at period end" : sub.current_period_end ? ` · renews ${new Date(sub.current_period_end).toLocaleDateString()}` : ""}
          </div>
          {!sub.cancel_at && (
            <button onClick={cancel} disabled={busy === "cancel"} className="text-sm font-extrabold text-rose-600 hover:underline disabled:opacity-50">
              {busy === "cancel" ? "Canceling…" : "Cancel subscription"}
            </button>
          )}
        </Card>
      )}

      <p className="mt-5 text-center text-xs text-slate-400">Prices in INR. Credits are a fair-use guard — normal studying never hits the limit.</p>

      {payFor && (
        <PayModal
          plan={payFor}
          providers={data.providers || []}
          paypalClientId={data.paypal_client_id}
          onClose={() => setPayFor(null)}
          onDone={onPaid}
        />
      )}
    </div>
  );
}

/* -------------------- Payment method chooser -------------------- */
function PayModal({ plan, providers, paypalClientId, onClose, onDone }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const name = plan.name.replace(" (annual)", "");
  const hasRzp = providers.some((p) => p.key === "razorpay");
  const hasPaypal = providers.some((p) => p.key === "paypal") && !!paypalClientId;
  const onlyManual = providers.length === 1 && providers[0].key === "manual";

  // Razorpay Checkout → verify signature on success (works without a public webhook).
  const payRazorpay = async () => {
    setBusy("razorpay"); setErr("");
    try {
      const res = await billingApi.checkout(plan.key, "razorpay");
      const c = res.checkout || {};
      await openRazorpayCheckout(c, name, async (rzp) => {
        await billingApi.razorpayVerify({
          plan_key: plan.key,
          order_id: rzp.razorpay_order_id,
          payment_id: rzp.razorpay_payment_id,
          signature: rzp.razorpay_signature,
        });
        onDone(plan);
      }, () => setBusy(""));
    } catch (e) { setErr(apiError(e, "Could not start payment.")); setBusy(""); }
  };

  // Dev/manual instant activation (no card).
  const payManual = async () => {
    setBusy("manual"); setErr("");
    try { await billingApi.checkout(plan.key, "manual"); onDone(plan); }
    catch (e) { setErr(apiError(e, "Could not activate.")); setBusy(""); }
  };

  // PayPal Smart Buttons.
  useEffect(() => {
    if (!hasPaypal) return;
    let cancelled = false;
    loadPaypalSdk(paypalClientId).then(() => {
      if (cancelled || !window.paypal) return;
      const el = document.getElementById("paypal-btns");
      if (!el) return;
      el.innerHTML = "";
      window.paypal.Buttons({
        style: { layout: "horizontal", height: 42, tagline: false },
        createOrder: async () => {
          const res = await billingApi.checkout(plan.key, "paypal");
          return res.checkout.order_id;
        },
        onApprove: async (data) => {
          setBusy("paypal");
          try { await billingApi.paypalCapture(data.orderID); onDone(plan); }
          catch (e) { setErr(apiError(e, "PayPal payment could not be confirmed.")); setBusy(""); }
        },
        onError: () => setErr("PayPal error — try another method."),
      }).render("#paypal-btns");
    }).catch(() => setErr("Couldn't load PayPal."));
    return () => { cancelled = true; };
  }, [hasPaypal, paypalClientId, plan.key]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-md p-6" >
        <div onClick={(e) => e.stopPropagation()}>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Upgrade to</p>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">{name}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ₹{plan.price_inr}{plan.billing_period === "year" ? "/year" : "/month"}
            {plan.price_usd ? ` · ≈ $${plan.price_usd} for PayPal` : ""}
          </p>

          <div className="mt-5 space-y-3">
            {hasRzp && (
              <Button className="w-full justify-center" disabled={!!busy} onClick={payRazorpay}>
                {busy === "razorpay" ? "Opening…" : `Pay ₹${plan.price_inr} — UPI / Card / NetBanking`}
              </Button>
            )}

            {hasRzp && hasPaypal && (
              <div className="flex items-center gap-3 text-[11px] font-bold uppercase text-slate-300">
                <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" /> or <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
              </div>
            )}

            {hasPaypal && <div id="paypal-btns" className="min-h-[42px]" />}

            {onlyManual && (
              <Button className="w-full justify-center" disabled={!!busy} onClick={payManual}>
                {busy === "manual" ? "Activating…" : "Activate (dev — no payment configured)"}
              </Button>
            )}
          </div>

          {err && <p className="mt-3 text-sm font-semibold text-rose-600">{err}</p>}

          <div className="mt-4 flex items-center justify-between text-[11px] text-slate-400">
            <span>🔒 Secure · Cancel anytime</span>
            <button onClick={onClose} className="font-extrabold text-slate-500 dark:text-slate-400 hover:text-slate-700">Cancel</button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* Load Razorpay Checkout and open it; calls onSuccess(response) on payment. */
function openRazorpayCheckout(checkout, planName, onSuccess, onDismiss) {
  const launch = () => {
    const rzp = new window.Razorpay({
      key: checkout.key_id,
      order_id: checkout.order_id,
      amount: checkout.amount,
      currency: checkout.currency || "INR",
      name: checkout.name || "AI Tutor",
      description: planName,
      handler: (resp) => onSuccess(resp),
      modal: { ondismiss: () => onDismiss && onDismiss() },
      theme: { color: "#6366f1" },
    });
    rzp.open();
  };
  if (window.Razorpay) return Promise.resolve(launch());
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => { launch(); resolve(); };
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

/* Load the PayPal JS SDK once (memoised by client id). */
let _paypalPromise = null;
function loadPaypalSdk(clientId) {
  if (window.paypal) return Promise.resolve();
  if (_paypalPromise) return _paypalPromise;
  _paypalPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
  return _paypalPromise;
}

/* -------------------- Usage panel (your consumption vs plan) -------------------- */
function UsagePanel({ usage }) {
  const s = usage.summary || {};
  const daily = s.daily || {}, monthly = s.monthly || {};
  const acts = usage.by_action || [];
  const maxC = Math.max(1, ...acts.map((a) => a.credits));

  return (
    <Card className="mt-6 p-5">
      <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Activity className="h-4 w-4 text-indigo-500" /> Your usage · {s.plan?.name}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <UsageBar label="Today" used={daily.used} limit={daily.limit} note="resets daily" />
        <UsageBar label="This month" used={monthly.used} limit={monthly.limit} note="resets monthly" />
      </div>

      {acts.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Where your credits went · last 30 days</p>
          <div className="mt-2 space-y-2">
            {acts.map((a) => (
              <div key={a.action} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate text-slate-600 dark:text-slate-300">{a.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max(3, (a.credits / maxC) * 100)}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-slate-400">{a.credits} cr · {a.calls}×</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function UsageBar({ label, used = 0, limit = 0, note }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 90 ? "bg-rose-400" : pct >= 70 ? "bg-amber-400" : "bg-indigo-400";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-extrabold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="text-slate-400">{Math.round(used)} / {limit} credits</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{Math.max(0, limit - Math.round(used))} left · {note}</p>
    </div>
  );
}

/* -------------------- What uses a credit -------------------- */
function CreditCosts({ costs }) {
  return (
    <Card className="mt-6 p-5">
      <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Coins className="h-4 w-4 text-amber-500" /> What uses a credit
      </p>
      <p className="mt-1 text-xs text-slate-400">Most actions cost just 1 credit. You only spend when the AI does work for you.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {costs.map((c) => (
          <div key={c.action} className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2 text-sm">
            <span className="text-slate-600 dark:text-slate-300">{c.label}</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-extrabold text-amber-600">
              {c.credits} credit{c.credits === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

