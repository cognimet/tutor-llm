import React, { useEffect, useState } from "react";
import {
  X, Loader2, Link2, Unlink, AlertCircle,
} from "lucide-react";
import CurriculumPicker from "../../ui/CurriculumPicker.jsx";
import { adminApi } from "../../api/endpoints.js";

const ROLE_BADGE = {
  student: "bg-indigo-50 text-indigo-600",
  parent:  "bg-emerald-50 text-emerald-600",
  admin:   "bg-amber-50 text-amber-600",
};

const SEVERITY_BADGE = {
  low:    "bg-sky-50 text-sky-600",
  medium: "bg-amber-50 text-amber-600",
  high:   "bg-rose-50 text-rose-600",
};

const inputCls = "w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:ring-2 focus:ring-indigo-200";

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/* ─── Profile tab ────────────────────────────────────────────────────────── */

function ProfileTab({ form, set, role, user, onCurriculumChange }) {
  return (
    <div className="space-y-4">
      <Field label="Name">
        <input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} className={inputCls} />
      </Field>
      <Field label="Email">
        <input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} className={inputCls} />
      </Field>
      {role === "student" && (
        <Field label="Language">
          <select value={form.language ?? "en"} onChange={(e) => set("language", e.target.value)} className={inputCls}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="hinglish">Hinglish</option>
          </select>
        </Field>
      )}
      <label className="flex items-center gap-2.5 text-sm font-bold text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={!!form.is_active}
          onChange={(e) => set("is_active", e.target.checked)}
          className="h-4 w-4 rounded accent-indigo-500"
        />
        Account active
      </label>

      {role === "student" && (
        <div className="space-y-2 rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Curriculum assignment</p>
          {user.curriculum_path && (
            <p className="text-xs text-slate-400">
              Current: <span className="font-extrabold text-slate-600">{user.curriculum_path}</span>
            </p>
          )}
          <CurriculumPicker value={user.level_id} onChange={onCurriculumChange} />
        </div>
      )}
    </div>
  );
}

/* ─── Activity tab (student only) ───────────────────────────────────────── */

function ActivityTab({ progress }) {
  if (!progress) {
    return (
      <div className="flex items-center gap-3 py-10 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm font-bold">Loading activity…</span>
      </div>
    );
  }

  const { summary, assessments, gaps, chat_count } = progress;
  const stats = [
    { label: "Mastery",     value: `${summary.mastery}%` },
    { label: "Assessments", value: summary.assessments_taken },
    { label: "Open gaps",   value: summary.open_gaps },
    { label: "Chats",       value: chat_count },
  ];

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-slate-50 px-2 py-3 text-center">
            <p className="text-xl font-extrabold text-slate-900">{s.value}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Recent assessments */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Recent assessments</p>
        {assessments.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 py-5 text-center text-sm text-slate-400">No assessments yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100">
            {assessments.map((a) => (
              <div key={a.id} className="flex items-center justify-between bg-white px-4 py-2.5">
                <p className="max-w-[55%] truncate text-xs font-bold text-slate-700">{a.topic_name}</p>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${a.score >= a.total * 0.7 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                    {a.score}/{a.total}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {a.completed_at ? new Date(a.completed_at).toLocaleDateString() : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open knowledge gaps */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Open knowledge gaps</p>
        {gaps.length === 0 ? (
          <p className="rounded-2xl bg-emerald-50 py-5 text-center text-sm font-bold text-emerald-600">
            No open gaps — great work!
          </p>
        ) : (
          <div className="space-y-2">
            {gaps.map((g) => (
              <div key={g.id} className="rounded-2xl border border-slate-100 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-slate-800">{g.topic_name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{g.concept}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold capitalize ${SEVERITY_BADGE[g.severity] ?? "bg-slate-50 text-slate-500"}`}>
                    {g.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Parents tab (student only) ────────────────────────────────────────── */

function ParentsTab({ parents, onUnlink }) {
  return (
    <div>
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
        Linked parents ({parents.length})
      </p>
      {parents.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 py-8 text-center text-sm text-slate-400">No linked parents.</p>
      ) : (
        <div className="space-y-2">
          {parents.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-slate-800">{p.name}</p>
                <p className="truncate text-xs text-slate-400">{p.email}</p>
                {p.relationship && (
                  <p className="mt-0.5 text-[10px] capitalize text-slate-400">{p.relationship}</p>
                )}
              </div>
              <button
                onClick={() => onUnlink(p.id)}
                className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-extrabold text-slate-500 hover:border-rose-200 hover:text-rose-600"
              >
                <Unlink className="h-3 w-3" /> Unlink
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Children tab (parent only) ────────────────────────────────────────── */

function ChildrenTab({ children, onUnlink, linkEmail, setLinkEmail, onLink, linking, linkError }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
          Linked children ({children.length})
        </p>
        {children.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 py-8 text-center text-sm text-slate-400">No linked children.</p>
        ) : (
          <div className="space-y-2">
            {children.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-slate-800">{c.name}</p>
                  <p className="truncate text-xs text-slate-400">{c.curriculum_path || c.email}</p>
                  {c.relationship && (
                    <p className="mt-0.5 text-[10px] capitalize text-slate-400">{c.relationship}</p>
                  )}
                </div>
                <button
                  onClick={() => onUnlink(c.id)}
                  className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-extrabold text-slate-500 hover:border-rose-200 hover:text-rose-600"
                >
                  <Unlink className="h-3 w-3" /> Unlink
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Link a student */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Link a student</p>
        <div className="flex gap-2">
          <input
            value={linkEmail}
            onChange={(e) => setLinkEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onLink()}
            placeholder="Student email address…"
            className="flex-1 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button
            onClick={onLink}
            disabled={linking || !linkEmail.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-indigo-500 px-4 py-2.5 text-sm font-extrabold text-white shadow-md disabled:opacity-50"
          >
            {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Link
          </button>
        </div>
        {linkError && (
          <p className="mt-1.5 flex items-center gap-1 text-xs font-bold text-rose-500">
            <AlertCircle className="h-3.5 w-3.5" /> {linkError}
          </p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main drawer
═══════════════════════════════════════════════════════════════════════════ */

export default function UserDrawer({ user: initialUser, onClose, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [progress, setProgress] = useState(null);
  const [form, setForm] = useState({});
  const [curr, setCurr] = useState(null);
  const [tab, setTab] = useState("profile");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const loadDetail = async () => {
    const d = await adminApi.userDetail(initialUser.id);
    setDetail(d);
    setForm({
      name:      d.user.name,
      email:     d.user.email,
      language:  d.user.language || "en",
      is_active: d.user.is_active ?? true,
    });
  };

  useEffect(() => { loadDetail(); }, [initialUser.id]);

  useEffect(() => {
    if (detail?.user?.role === "student") {
      adminApi.userProgress(detail.user.id).then(setProgress).catch(() => {});
    }
  }, [detail?.user?.id, detail?.user?.role]);

  const save = async () => {
    setSaving(true);
    setSaveOk(false);
    try {
      const payload = { ...form };
      if (curr) { payload.level_id = curr.level_id; payload.stream = curr.stream; }
      const updated = await adminApi.updateUser(initialUser.id, payload);
      setDetail((d) => ({ ...d, user: { ...d.user, ...updated } }));
      onSaved?.(updated);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } finally { setSaving(false); }
  };

  const unlinkParent = async (parentId) => {
    await adminApi.unlinkChild(parentId, detail.user.id);
    setDetail((d) => ({ ...d, parents: d.parents.filter((p) => p.id !== parentId) }));
  };

  const unlinkChild = async (childId) => {
    await adminApi.unlinkChild(detail.user.id, childId);
    setDetail((d) => ({ ...d, children: d.children.filter((c) => c.id !== childId) }));
  };

  const linkChild = async () => {
    if (!linkEmail.trim()) return;
    setLinking(true);
    setLinkError("");
    try {
      const res = await adminApi.linkChild(detail.user.id, linkEmail.trim(), "guardian");
      setDetail((d) => ({ ...d, children: [...d.children, res.child] }));
      setLinkEmail("");
    } catch (e) {
      setLinkError(e.response?.data?.message || "Could not link. Check the email.");
    } finally { setLinking(false); }
  };

  const role = initialUser.role;
  const TABS = [
    { key: "profile", label: "Profile" },
    ...(role === "student"
      ? [{ key: "activity", label: "Activity" }, { key: "parents", label: "Parents" }]
      : role === "parent"
      ? [{ key: "children", label: "Children" }]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="drawer-in-right absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 text-xl font-extrabold text-indigo-600">
            {(initialUser.name?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold text-slate-900">{detail?.user?.name ?? initialUser.name}</p>
            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-extrabold capitalize ${ROLE_BADGE[role] ?? "bg-slate-50 text-slate-500"}`}>
              {role}
            </span>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 hover:text-rose-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        {TABS.length > 1 && (
          <div className="flex gap-1 border-b border-slate-100 px-4 py-2">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition-colors ${tab === t.key ? "bg-indigo-500 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!detail ? (
            <div className="flex h-full items-center justify-center gap-3 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-bold">Loading…</span>
            </div>
          ) : (
            <div className="p-5">
              {tab === "profile" && (
                <ProfileTab form={form} set={set} role={role} user={detail.user} onCurriculumChange={setCurr} />
              )}
              {tab === "activity" && <ActivityTab progress={progress} />}
              {tab === "parents" && (
                <ParentsTab parents={detail.parents ?? []} onUnlink={unlinkParent} />
              )}
              {tab === "children" && (
                <ChildrenTab
                  children={detail.children ?? []}
                  onUnlink={unlinkChild}
                  linkEmail={linkEmail}
                  setLinkEmail={setLinkEmail}
                  onLink={linkChild}
                  linking={linking}
                  linkError={linkError}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer: save button only on profile tab */}
        {tab === "profile" && (
          <div className="border-t border-slate-100 px-5 py-4">
            <button
              onClick={save}
              disabled={saving || !detail}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-extrabold text-white shadow-lg transition hover:shadow-xl active:scale-[0.98] disabled:opacity-50 ${
                saveOk
                  ? "bg-gradient-to-br from-emerald-500 to-teal-500 shadow-emerald-500/30"
                  : "bg-gradient-to-br from-indigo-500 to-violet-500 shadow-indigo-500/30"
              }`}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saveOk ? "Saved!" : "Save changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
