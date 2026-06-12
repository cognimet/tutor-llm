import React, { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { curriculumApi } from "../api/endpoints.js";

/**
 * Guided Stage → Track → Level onboarding selector driven by the admin-managed
 * curriculum tree. Instead of three native dropdowns it reveals one friendly,
 * tappable step at a time, so signing up feels like onboarding rather than
 * filling a form.
 *
 * Emits a normalised selection (or null) whenever a full Stage→Track→Level path
 * is chosen — identical contract to before, so callers don't change:
 *   selection = { level_id, stream, board, grade, label }
 */
export default function CurriculumPicker({ stages: provided, value, onChange }) {
  const [stages, setStages] = useState(provided || null);
  const [stageId, setStageId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [levelId, setLevelId] = useState(value || "");

  useEffect(() => {
    if (provided) { setStages(provided); return; }
    let alive = true;
    curriculumApi.options().then((s) => { if (alive) setStages(s); }).catch(() => {});
    return () => { alive = false; };
  }, [provided]);

  // Seed from an incoming level_id (e.g. editing an existing profile).
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
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-white dark:bg-slate-800 px-3.5 py-3 text-sm font-semibold text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-400" /> Loading your curriculum…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Step n={1} title="Which stage are you at?" done={!!stage}>
        <ChipGroup>
          {stages.map((s) => (
            <Chip key={s.id} active={Number(stageId) === s.id} onClick={() => pickStage(s.id)}
              emoji={s.emoji} label={s.name} />
          ))}
        </ChipGroup>
      </Step>

      {stage && (
        <Step n={2} title="Which board or exam?" done={!!track} animate>
          <ChipGroup>
            {(stage.tracks || []).map((t) => (
              <Chip key={t.id} active={Number(trackId) === t.id} onClick={() => pickTrack(t.id)}
                emoji={t.emoji} label={t.name} />
            ))}
          </ChipGroup>
        </Step>
      )}

      {track && (
        <Step n={3} title="Which class are you in?" done={!!levelId} animate>
          <ChipGroup>
            {levels.map((l) => (
              <Chip key={l.id} active={Number(levelId) === l.id} onClick={() => pickLevel(l.id)}
                label={l.name} />
            ))}
          </ChipGroup>
        </Step>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- pieces */

function Step({ n, title, done, animate, children }) {
  return (
    <div className={animate ? "auth-rise" : undefined}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold transition-colors ${done ? "bg-indigo-500 text-white" : "bg-indigo-100 text-indigo-600"}`}>
          {done ? <Check className="h-3 w-3" strokeWidth={3.5} /> : n}
        </span>
        <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{title}</span>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

function ChipGroup({ children }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Chip({ active, onClick, emoji, label }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold transition-all active:scale-[0.97] ${
        active
          ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500"
          : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-600"
      }`}>
      {emoji && <span className="text-[15px] leading-none">{emoji}</span>}
      {label}
      {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </button>
  );
}
