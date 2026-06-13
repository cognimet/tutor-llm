import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Paperclip, Upload, FileText, FileSpreadsheet, FileImage, File as FileIcon,
  Check, Loader2, AlertTriangle, X, Trash2,
} from "lucide-react";
import { notesApi } from "../api/endpoints.js";

const ACCEPT = ".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff";

export function fmtBytes(n) {
  if (!n) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function NoteIcon({ kind, className = "h-4 w-4" }) {
  const Icon = kind === "sheet" ? FileSpreadsheet
    : kind === "image" ? FileImage
    : kind === "pdf" || kind === "doc" || kind === "text" ? FileText
    : FileIcon;
  return <Icon className={className} />;
}

/**
 * Composer attach control: a paperclip popover to upload study files and pick
 * which existing notes ride along with the next message. Selection lives in the
 * parent (so it can show chips + send note_ids); this component owns the list,
 * upload, and per-topic usage display.
 */
export default function NotesPicker({ ctx, grad, selectedIds = [], onToggle, onChanged }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [usage, setUsage] = useState({ used_bytes: 0, cap_bytes: 52428800 });
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef(null);
  const fileRef = useRef(null);

  const params = ctx.topic_id ? { topic_id: ctx.topic_id } : { topic_name: ctx.topic_name };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await notesApi.list(params);
      setNotes(data.notes || []);
      setUsage(data.usage || { used_bytes: 0, cap_bytes: 52428800 });
    } catch { /* ignore */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.topic_id, ctx.topic_name]);

  useEffect(() => { if (open) load(); }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > usage.cap_bytes - usage.used_bytes) {
      setError(`That file is too big for the remaining space (${fmtBytes(usage.cap_bytes - usage.used_bytes)} left).`);
      return;
    }
    setUploading(true);
    try {
      const note = await notesApi.upload(file, ctx);
      await load();
      onChanged?.();
      // Auto-select a freshly uploaded, readable note.
      if (note?.status === "ready" && note?.id) onToggle?.(note);
      if (note?.status === "failed") setError(note?.meta?.error || "That file couldn't be read.");
    } catch (err) {
      setError(err?.response?.data?.message || "Upload failed. Please try again.");
      await load();
    } finally { setUploading(false); }
  };

  const removeNote = async (id) => {
    try {
      await notesApi.remove(id);
      setNotes((n) => n.filter((x) => x.id !== id));
      onChanged?.();
      load();
    } catch { /* ignore */ }
  };

  const pct = Math.min(100, Math.round((usage.used_bytes / usage.cap_bytes) * 100));
  const selected = new Set(selectedIds);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Attach notes"
        aria-haspopup="menu" aria-expanded={open}
        className={`relative grid h-11 w-11 place-items-center rounded-2xl transition-colors ${
          open || selectedIds.length
            ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
            : "text-slate-400 hover:bg-slate-50 hover:text-indigo-600 dark:hover:bg-white/5"
        }`}
      >
        <Paperclip className="h-5 w-5" />
        {selectedIds.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-indigo-500 px-1 text-[10px] font-extrabold text-white">
            {selectedIds.length}
          </span>
        )}
      </button>

      {open && (
        <div className="msg-in absolute bottom-[3.25rem] left-0 z-30 w-[20rem] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl dark:border-white/10 dark:bg-slate-800">
          <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Notes for this topic</p>
            <button onClick={() => setOpen(false)} className="grid h-6 w-6 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"><X className="h-3.5 w-3.5" /></button>
          </div>

          {/* Usage bar */}
          <div className="px-3 pb-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div className={`h-full rounded-full ${pct > 90 ? "bg-rose-400" : "bg-gradient-to-r from-indigo-400 to-violet-500"}`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <p className="mt-1 text-[10px] font-bold text-slate-400">{fmtBytes(usage.used_bytes)} of {fmtBytes(usage.cap_bytes)} used</p>
          </div>

          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} />
          <div className="px-2">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className={`flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br ${grad} px-3 py-2 text-xs font-extrabold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-60`}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Reading your file…" : "Upload a file"}
            </button>
            <p className="px-1 pt-1 text-center text-[10px] text-slate-400">PDF, Word, Excel, images, text — clear, text-based files read best.</p>
          </div>

          {error && (
            <p className="mx-2 mt-2 flex items-start gap-1.5 rounded-xl bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          <div className="mt-1.5 max-h-64 overflow-y-auto p-1.5">
            {loading && notes.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs font-bold text-slate-400">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-400">No notes yet. Upload your first file above.</p>
            ) : notes.map((n) => {
              const ready = n.status === "ready";
              const checked = selected.has(n.id);
              return (
                <div key={n.id}
                  className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors ${
                    checked ? "bg-indigo-50 dark:bg-indigo-500/15" : "hover:bg-slate-50 dark:hover:bg-white/5"
                  }`}>
                  <button onClick={() => ready && onToggle?.(n)} disabled={!ready}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-not-allowed">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${checked ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-400 dark:bg-white/10"}`}>
                      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <NoteIcon kind={n.kind} className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-extrabold text-slate-700 dark:text-slate-200">{n.title}</span>
                      <span className="block text-[10px] font-bold text-slate-400">
                        {n.status === "processing" ? "Processing…"
                          : n.status === "failed" ? "Couldn't read this file"
                          : fmtBytes(n.size_bytes)}
                      </span>
                    </span>
                  </button>
                  {n.status === "processing" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" />}
                  <button onClick={() => removeNote(n.id)} title="Delete note"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
