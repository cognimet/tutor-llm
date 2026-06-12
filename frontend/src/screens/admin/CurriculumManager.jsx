import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronRight, Plus, Pencil, Trash2, Home, Layers, BookOpen, Folder, FileText,
  GraduationCap, Loader2, X, EyeOff,
} from "lucide-react";
import { Card } from "../../ui/components.jsx";
import { adminCurriculumApi } from "../../api/endpoints.js";

/* What each depth contains, how it's labelled, and which fields it has. */
const CHILD       = { root: "stage", stage: "track", track: "level", level: "subject", subject: "chapter", chapter: "topic" };
const CHILD_KEY   = { stage: "tracks", track: "levels", level: "subjects", subject: "chapters", chapter: "topics" };
const PARENT_FIELD = { track: "stage_id", level: "track_id", subject: "level_id", chapter: "subject_id", topic: "chapter_id" };
const LABEL       = { stage: "Stage", track: "Track (Board / Exam / Programme)", level: "Level (Class / Year / Sem)", subject: "Subject", chapter: "Chapter", topic: "Topic" };
const PLURAL      = { stage: "stages", track: "tracks", level: "levels", subject: "subjects", chapter: "chapters", topic: "topics" };
const FIELDS      = {
  stage:   ["name", "emoji", "blurb"],
  track:   ["name", "emoji", "tint", "blurb"],
  level:   ["name", "stream", "class_number"],
  subject: ["name", "emoji", "tint", "blurb"],
  chapter: ["name"],
  topic:   ["name"],
};
const ICON = { stage: GraduationCap, track: Layers, level: BookOpen, subject: Folder, chapter: FileText, topic: FileText };
const TINTS = ["indigo", "violet", "emerald", "amber", "rose", "sky"];

// Resolve the list to show + the type of children to add, by walking the path.
function resolve(stages, path) {
  if (path.length === 0) return { items: stages, parent: null, childType: "stage" };
  let nodes = stages, node = null;
  for (const seg of path) {
    node = (nodes || []).find((n) => n.id === seg.id && n.type === seg.type);
    if (!node) return null; // stale path after a refetch
    nodes = node[CHILD_KEY[node.type]] || [];
  }
  return { items: nodes, parent: node, childType: CHILD[node.type] };
}

export default function CurriculumManager() {
  const [stages, setStages] = useState(null);
  const [path, setPath] = useState([]);      // [{type,id,name}, …]
  const [editing, setEditing] = useState(null); // { mode:'create'|'edit', type, node? }
  const [busy, setBusy] = useState(false);

  const load = async () => setStages(await adminCurriculumApi.tree());
  useEffect(() => { load(); }, []);

  const view = useMemo(() => (stages ? resolve(stages, path) : null), [stages, path]);
  // If a refetch invalidated the path (deleted ancestor), pop back to root.
  useEffect(() => { if (stages && view === null) setPath([]); }, [stages, view]);

  if (!stages) {
    return <div className="flex items-center gap-3 py-20 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /><span className="font-bold">Loading curriculum…</span></div>;
  }
  if (!view) return null;

  const { items, parent, childType } = view;
  const canDrill = childType !== "topic" || true; // topics are leaves; drilling stops at them

  const save = async (form) => {
    setBusy(true);
    try {
      if (editing.mode === "edit") {
        await adminCurriculumApi.update(editing.type, editing.node.id, form);
      } else {
        const payload = { ...form };
        if (PARENT_FIELD[childType] && parent) payload[PARENT_FIELD[childType]] = parent.id;
        await adminCurriculumApi.create(childType, payload);
      }
      await load();
      setEditing(null);
    } finally { setBusy(false); }
  };

  const remove = async (node) => {
    const kids = (node[CHILD_KEY[node.type]] || []).length;
    const warn = kids ? `\n\nThis also deletes ${kids} item(s) inside it.` : "";
    if (!window.confirm(`Delete "${node.name}"?${warn}`)) return;
    await adminCurriculumApi.remove(node.type, node.id);
    await load();
  };

  return (
    <>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Curriculum</h1>
          <p className="text-slate-500 dark:text-slate-400">Manage the whole Stage → Track → Level → Subject → Chapter → Topic tree.</p>
        </div>
        <button
          onClick={() => setEditing({ mode: "create", type: childType })}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/30 transition hover:shadow-xl active:scale-95"
        >
          <Plus className="h-4 w-4" /> Add {LABEL[childType].split(" ")[0]}
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="mt-5 flex flex-wrap items-center gap-1 text-sm font-bold">
        <button onClick={() => setPath([])} className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${path.length === 0 ? "bg-indigo-50 text-indigo-600" : "text-slate-500 dark:text-slate-400 hover:bg-white"}`}>
          <Home className="h-3.5 w-3.5" /> All stages
        </button>
        {path.map((seg, i) => (
          <span key={`${seg.type}-${seg.id}`} className="flex items-center gap-1">
            <ChevronRight className="h-4 w-4 text-slate-300" />
            <button onClick={() => setPath(path.slice(0, i + 1))}
              className={`rounded-lg px-2 py-1 ${i === path.length - 1 ? "bg-indigo-50 text-indigo-600" : "text-slate-500 dark:text-slate-400 hover:bg-white"}`}>
              {seg.name}
            </button>
          </span>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 px-5 py-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">
            {items.length} {LABEL[childType].split(" ")[0]}{items.length === 1 ? "" : "s"}
            {parent ? ` in ${parent.name}` : ""}
          </p>
        </div>

        {items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Nothing here yet. Add the first {childType}.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((node) => {
              const Icon = ICON[node.type];
              const kids = node[CHILD_KEY[node.type]] || [];
              const drillable = node.type !== "topic";
              return (
                <li key={node.id} className="group flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 text-lg">
                    {node.emoji || <Icon className="h-4 w-4" />}
                  </span>
                  <button
                    onClick={() => drillable && setPath([...path, { type: node.type, id: node.id, name: node.name }])}
                    className="min-w-0 flex-1 text-left"
                    disabled={!drillable}
                  >
                    <p className="flex items-center gap-2 truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">
                      {node.name}
                      {node.is_active === false && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-400"><EyeOff className="h-3 w-3" /> hidden</span>}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {[node.stream, node.class_number ? `Class ${node.class_number}` : null, drillable ? `${kids.length} ${CHILD[node.type]}${kids.length === 1 ? "" : "s"}` : null, node.blurb]
                        .filter(Boolean).join(" · ") || "—"}
                    </p>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => setEditing({ mode: "edit", type: node.type, node })} title="Edit" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(node)} title="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  {drillable && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editing && (
        <NodeForm
          title={editing.mode === "edit" ? `Edit ${LABEL[editing.type].split(" ")[0]}` : `Add ${LABEL[editing.type].split(" ")[0]}`}
          type={editing.type}
          node={editing.node}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </>
  );
}

function NodeForm({ title, type, node, busy, onClose, onSave }) {
  const fields = FIELDS[type];
  const [form, setForm] = useState(() => {
    const init = {};
    for (const f of fields) init[f] = node?.[f] ?? "";
    if (node) init.is_active = node.is_active ?? true;
    return init;
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    const payload = {};
    for (const f of fields) {
      let v = form[f];
      if (f === "class_number") v = v === "" ? null : Number(v);
      if (typeof v === "string") v = v.trim();
      payload[f] = v === "" ? null : v;
    }
    if (node) payload.is_active = !!form.is_active;
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-md rounded-3xl border border-white/60 dark:border-white/10 bg-white dark:bg-slate-800 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-white/10"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-5 space-y-3">
          {fields.includes("name") && <Text label="Name" value={form.name} onChange={(v) => set("name", v)} required autoFocus />}
          {fields.includes("emoji") && <Text label="Emoji" value={form.emoji} onChange={(v) => set("emoji", v)} placeholder="📐" />}
          {fields.includes("tint") && (
            <Field label="Colour">
              <select value={form.tint || "indigo"} onChange={(e) => set("tint", e.target.value)} className={inputCls}>
                {TINTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          )}
          {fields.includes("stream") && (
            <Field label="Stream (optional)">
              <select value={form.stream || ""} onChange={(e) => set("stream", e.target.value)} className={inputCls}>
                <option value="">— none —</option>
                <option value="science">Science</option>
                <option value="commerce">Commerce</option>
                <option value="arts">Arts</option>
              </select>
            </Field>
          )}
          {fields.includes("class_number") && <Text label="Class number (optional)" type="number" value={form.class_number} onChange={(v) => set("class_number", v)} placeholder="e.g. 10" />}
          {fields.includes("blurb") && <Text label="Short description" value={form.blurb} onChange={(v) => set("blurb", v)} placeholder="One line" />}
          {node && (
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={!!form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 rounded" />
              Visible to students
            </label>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-2xl px-4 py-2.5 text-sm font-extrabold text-slate-500 dark:text-slate-400 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-extrabold text-white shadow-lg disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls = "w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200";
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>{children}</label>;
}
function Text({ label, value, onChange, ...props }) {
  return <Field label={label}><input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputCls} {...props} /></Field>;
}
