/**
 * The curriculum as a game world.
 *
 * Each topic is a node; prerequisites are locked gates that open as mastery
 * grows. The map *is* the learning path — the student experiences pathing as
 * exploration rather than as a to-do list (blueprint §5). The "Play next" card
 * surfaces the path engine's recommendation, so there is always one obvious move.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Lock, Play, CheckCircle2, Sparkles, Target, Loader2, Flame, Trophy, NotebookPen, Zap, Star } from "lucide-react";
import { questApi, gamificationApi } from "../../../api/endpoints.js";
import { Spinner, EmptyState } from "../../../ui/components.jsx";
import { ReviewCard } from "../../../ui/TodayCards.jsx";
import GamePlayer from "./GamePlayer.jsx";

const STATUS = {
  mastered: {
    label: "Mastered",
    ring: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10",
    dot: "bg-emerald-500",
  },
  in_progress: {
    label: "In progress",
    ring: "border-indigo-300 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-500/10",
    dot: "bg-indigo-500",
  },
  available: {
    label: "Ready to play",
    ring: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800",
    dot: "bg-slate-300",
  },
  locked: {
    label: "Locked",
    ring: "border-slate-200 bg-slate-50 opacity-60 dark:border-slate-800 dark:bg-slate-900",
    dot: "bg-slate-300",
  },
};

export default function QuestMap({ onBack, home = false, user, onOpenRewards, onOpenNotebooks }) {
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState(null);
  const [map, setMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(null); // {topicId, topicName, difficulty}
  const [stats, setStats] = useState(null); // gamification: streak / xp / level (home only)

  // In home mode this screen IS the dashboard, so pull the reward stats and keep
  // them fresh as games are played.
  useEffect(() => {
    if (!home) return;
    const load = () => gamificationApi.stats().then(setStats).catch(() => {});
    load();
    window.addEventListener("progress:refresh", load);
    return () => window.removeEventListener("progress:refresh", load);
  }, [home]);

  useEffect(() => {
    questApi
      .subjects()
      .then((s) => {
        setSubjects(s);
        setSubjectId(s[0]?.id ?? null);
      })
      .catch(() => setSubjects([]))
      .finally(() => setLoading(false));
  }, []);

  const loadMap = useCallback(() => {
    if (!subjectId) return;
    questApi.map(subjectId).then(setMap).catch(() => setMap(null));
  }, [subjectId]);

  useEffect(() => {
    setMap(null);
    loadMap();
  }, [loadMap]);

  const subject = subjects.find((s) => s.id === subjectId);
  const nodeById = (id) => map?.nodes.find((n) => n.topic_id === id);

  const play = (node, difficulty) => {
    if (node.status === "locked") return;
    setPlaying({ topicId: node.topic_id, topicName: node.name, difficulty });
  };

  if (loading) return <Spinner label="Building your quest map…" />;

  if (!subjects.length) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState emoji="🗺️" title="Your quest map isn't built yet"
          hint="Pick your class and board first — the map is made from your own curriculum." />
      </div>
    );
  }

  const firstName = (user?.name || "").trim().split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6">
      {home ? (
        /* This screen is the student's home — a gamified header, not a back link. */
        <div className="mb-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-800 dark:text-slate-100">
                {firstName ? `Hi ${firstName}! ` : ""}Ready to play?
              </h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Learn by playing — clear a topic to unlock the next.
              </p>
            </div>
            <div className="flex gap-2">
              {onOpenNotebooks && (
                <button onClick={onOpenNotebooks}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <NotebookPen className="h-4 w-4 text-indigo-500" /> Notebooks
                </button>
              )}
              {onOpenRewards && (
                <button onClick={onOpenRewards}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-extrabold text-amber-600 shadow-sm transition-all hover:-translate-y-0.5 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  <Trophy className="h-4 w-4" /> Rewards
                </button>
              )}
            </div>
          </div>

          {/* Reward stats — streak, XP/stars, level. */}
          {stats && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <StatChip icon={Flame} tint="rose" label="Day streak" value={`${stats.streak || 0}`} />
              <StatChip
                icon={stats.currency === "stars" ? Star : Zap}
                tint="amber"
                label={stats.currency === "stars" ? "Magic stars" : "Adventure XP"}
                value={`${stats.currency === "stars" ? stats.magic_stars : stats.xp_points}`}
              />
              <StatChip icon={Trophy} tint="indigo" label={stats.rank || "Level"} value={`Lv ${stats.level || 1}`} />
            </div>
          )}

          {/* Spaced repetition: mastered topics gone stale open as review games. */}
          <ReviewCard className="mt-4"
            onPlay={(d) => setPlaying({ topicId: d.topic_id, topicName: d.topic_name, difficulty: d.difficulty })} />
        </div>
      ) : (
        <>
          <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-indigo-600">
            <ArrowLeft className="h-4 w-4" /> Home
          </button>
          <h1 className="text-3xl font-black tracking-tight text-slate-800 dark:text-slate-100">Quest map</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Master a topic to unlock the ones that build on it.
          </p>
        </>
      )}

      {/* Subject worlds */}
      <div className="mt-6 flex gap-3 overflow-x-auto pb-2">
        {subjects.map((s) => (
          <button key={s.id} onClick={() => setSubjectId(s.id)}
            className={`min-w-40 shrink-0 rounded-2xl border-2 p-3 text-left transition-all ${
              s.id === subjectId
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10"
                : "border-slate-200 bg-white hover:-translate-y-0.5 dark:border-slate-700 dark:bg-slate-800"
            }`}>
            <div className="text-xl">{s.emoji || "📘"}</div>
            <div className="mt-1 truncate text-sm font-extrabold text-slate-700 dark:text-slate-200">{s.name}</div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${s.percent}%` }} />
            </div>
            <div className="mt-1 text-[11px] font-bold text-slate-400">{s.mastered}/{s.topics} mastered</div>
          </button>
        ))}
      </div>

      {!map ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : (
        <>
          {/* The path engine's single next move. For a brand-new student this
              doubles as onboarding: one obvious button, first star in a minute. */}
          {map.next && (
            <div className="mt-6 rounded-3xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-5 dark:border-indigo-500/30 dark:from-indigo-500/10 dark:to-purple-500/10">
              <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-indigo-500">
                <Sparkles className="h-3.5 w-3.5" />
                {home && stats && !stats.streak && !(stats.magic_stars || 0) && !(stats.xp_points || 0)
                  ? "Welcome! Your first star awaits ⭐"
                  : map.next.is_review ? "Time to review" : "Play next"}
              </div>
              <h2 className="mt-1.5 text-xl font-black text-slate-800 dark:text-slate-100">{map.next.topic_name}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">{map.next.reason}</p>
              <button
                onClick={() => {
                  const node = nodeById(map.next.topic_id);
                  if (node) play(node, map.next.recommended_difficulty);
                }}
                className="mt-4 flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-indigo-700">
                <Play className="h-4 w-4" /> Play — level {map.next.recommended_difficulty}
              </button>
            </div>
          )}

          {/* Root gaps: fix the cause, not the symptom. */}
          {map.gaps?.some((g) => g.is_root) && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-amber-600">
                <Target className="h-3.5 w-3.5" /> Worth fixing first
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {map.gaps.filter((g) => g.is_root).slice(0, 3).map((g) => g.name).join(" · ")}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                These unlock the most topics further along.
              </p>
            </div>
          )}

          {/* The map itself. */}
          <div className="mt-6 space-y-2">
            {map.nodes.map((node) => {
              const style = STATUS[node.status] || STATUS.available;
              const pct = Math.round(node.p_mastered * 100);
              const locked = node.status === "locked";
              const blockers = node.prerequisites
                .map((id) => nodeById(id))
                .filter((p) => p && p.status !== "mastered")
                .map((p) => p.name);

              return (
                <button key={node.topic_id} disabled={locked} onClick={() => play(node, null)}
                  className={`flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all ${style.ring} ${
                    locked ? "cursor-not-allowed" : "hover:-translate-y-0.5 hover:shadow-md"
                  }`}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-extrabold text-slate-700 dark:text-slate-200">{node.name}</div>
                    {locked && blockers.length > 0 ? (
                      <div className="mt-0.5 truncate text-xs font-semibold text-slate-400">
                        Master {blockers.join(", ")} first
                      </div>
                    ) : (
                      <div className="mt-1.5 h-1.5 max-w-48 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                          style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>

                  {node.status === "mastered" ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  ) : locked ? (
                    <Lock className="h-4 w-4 shrink-0 text-slate-300" />
                  ) : (
                    <span className="shrink-0 text-xs font-extrabold text-slate-400">{pct}%</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {playing && (
        <GamePlayer
          topicId={playing.topicId}
          topicName={playing.topicName}
          difficulty={playing.difficulty}
          onClose={() => {
            setPlaying(null);
            loadMap();
          }}
          onFinished={loadMap}
        />
      )}
    </div>
  );
}

const CHIP_TINTS = {
  rose: "text-rose-500 bg-rose-50 dark:bg-rose-500/10",
  amber: "text-amber-500 bg-amber-50 dark:bg-amber-500/10",
  indigo: "text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10",
};

function StatChip({ icon: Icon, tint, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${CHIP_TINTS[tint] || CHIP_TINTS.indigo}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-base font-black text-slate-800 dark:text-slate-100">{value}</div>
        <div className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      </div>
    </div>
  );
}
