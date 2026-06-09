import React, { useEffect, useMemo, useState } from "react";
import { curriculumApi } from "../api/endpoints.js";

/**
 * Cascading Stage → Track → Level selector driven by the admin-managed tree.
 * Calls onChange with a normalised selection (or null) whenever a full
 * Stage→Track→Level path is chosen.
 *
 *   selection = { level_id, stream, board, grade, label }
 */
export default function CurriculumPicker({ stages: provided, value, onChange }) {
  const [stages, setStages] = useState(provided || null);
  const [stageId, setStageId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [levelId, setLevelId] = useState(value || "");

  // Load options once (unless the parent supplied them).
  useEffect(() => {
    if (provided) { setStages(provided); return; }
    let alive = true;
    curriculumApi.options().then((s) => { if (alive) setStages(s); }).catch(() => {});
    return () => { alive = false; };
  }, [provided]);

  // Seed the dropdowns from an incoming level_id.
  useEffect(() => {
    if (!stages || !value) return;
    for (const s of stages) for (const t of s.tracks) {
      if (t.levels.some((l) => l.id === value)) {
        setStageId(s.id); setTrackId(t.id); setLevelId(value); return;
      }
    }
  }, [stages, value]);

  const stage = useMemo(() => stages?.find((s) => s.id === Number(stageId)), [stages, stageId]);
  const track = useMemo(() => stage?.tracks.find((t) => t.id === Number(trackId)), [stage, trackId]);
  const levels = track?.levels || [];

  const emit = (lvlId) => {
    const level = levels.find((l) => l.id === Number(lvlId));
    if (!level || !track || !stage) { onChange?.(null); return; }
    onChange?.({
      level_id: level.id,
      stream: level.stream || null,
      board: track.slug || null,
      grade: level.class_number || null,
      label: `${stage.name} · ${track.name} · ${level.name}`,
    });
  };

  const pickStage = (id) => { setStageId(id); setTrackId(""); setLevelId(""); onChange?.(null); };
  const pickTrack = (id) => { setTrackId(id); setLevelId(""); onChange?.(null); };
  const pickLevel = (id) => { setLevelId(id); emit(id); };

  if (!stages) {
    return <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm font-bold text-slate-400">Loading curriculum…</div>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Select label="Stage" value={stageId} onChange={pickStage} placeholder="Choose stage">
        {stages.map((s) => <option key={s.id} value={s.id}>{s.emoji ? `${s.emoji} ` : ""}{s.name}</option>)}
      </Select>
      <Select label="Board / Exam / Programme" value={trackId} onChange={pickTrack} placeholder="Choose track" disabled={!stage}>
        {(stage?.tracks || []).map((t) => <option key={t.id} value={t.id}>{t.emoji ? `${t.emoji} ` : ""}{t.name}</option>)}
      </Select>
      <Select label="Class / Year / Level" value={levelId} onChange={pickLevel} placeholder="Choose level" disabled={!track}>
        {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </Select>
    </div>
  );
}

function Select({ label, value, onChange, children, placeholder, disabled }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        <option value="">{placeholder}</option>
        {children}
      </select>
    </label>
  );
}
