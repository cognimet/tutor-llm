import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Star, Zap, Trophy, BookOpen, Gamepad2, Cookie, Heart, Shield, Loader2 } from "lucide-react";
import { gamificationApi } from "../../api/endpoints.js";
import { BadgeRow } from "../../ui/Gamification.jsx";
import TrophyCabinet, { TROPHY_CATALOGUE } from "../../ui/TrophyCabinet.jsx";
import StreakFlame from "../../ui/StreakFlame.jsx";
import StickerCanvas from "../../ui/StickerCanvas.jsx";
import TutoMascot from "../../ui/TutoMascot.jsx";
import useGameSound from "../../ui/useGameSound.js";

/**
 * Engine-aware gamification home (spec §6). Self-loads the student's profile and
 * renders the Junior dashboard (companion pet + sticker book + magic stars) for
 * Classes 1–4, or the Senior dashboard (XP gauge + trophy cabinet + streak) for
 * Classes 5–10.
 */
export default function GamificationDashboard({ user, onBack, onOpenNotes }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = () =>
    gamificationApi.profile().then(setData).catch(() => setError("Couldn't load your rewards yet."));

  useEffect(() => { load(); }, []);

  if (error) {
    return <Shell onBack={onBack}><p className="p-10 text-center text-sm font-bold text-slate-400">{error}</p></Shell>;
  }
  if (!data) {
    return <Shell onBack={onBack}><div className="grid place-items-center p-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div></Shell>;
  }

  return (
    <Shell onBack={onBack}>
      {data.engine_mode === "junior"
        ? <JuniorDashboard user={user} data={data} onReload={load} onOpenNotes={onOpenNotes} />
        : <SeniorDashboard user={user} data={data} onOpenNotes={onOpenNotes} />}
    </Shell>
  );
}

function Shell({ children, onBack }) {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 hover:text-indigo-600 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" /> Back home
      </button>
      {children}
    </div>
  );
}

/* ============================================================ SENIOR (5–10) */

function SeniorDashboard({ user, data, onOpenNotes }) {
  const sound = useGameSound();
  const pct = Math.min(100, Math.round(data.progress_percent || 0));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-sm font-bold text-white/80">Welcome back, {user.name.split(" ")[0]}</p>
            <h1 className="mt-0.5 text-2xl font-extrabold">Level {data.current_level} · {data.rank}</h1>
            <div className="mt-3 flex items-center gap-3">
              <Zap className="h-5 w-5 text-yellow-300" />
              <div className="w-56 max-w-full">
                <div className="flex justify-between text-xs font-bold text-white/80">
                  <span>{data.xp_into_level} XP</span><span>{data.next_level_xp} to next</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-yellow-300 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <StreakFlame streakDays={data.streak?.days || 0} />
            <Stat label="Trophies" value={data.trophies_count} icon={Trophy} />
            <Stat label="Badges" value={data.badges_count} icon={Star} />
          </div>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ActionTile onClick={() => { sound("pop"); onOpenNotes?.(); }} tint="from-indigo-500 to-violet-500"
          icon={BookOpen} title="Study & Quests" sub="Notes, plans and chapter quests" />
        <ShieldTile data={data} />
      </div>

      <TrophyCabinet trophies={data.trophies || []} catalogue={TROPHY_CATALOGUE}
        level={data.current_level} rank={data.rank} />

      {data.badges?.length > 0 && (
        <div className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-sm dark:border-white/10 dark:bg-slate-800/70">
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">My Badges</h3>
          <BadgeRow badges={data.badges} />
        </div>
      )}
    </div>
  );
}

function ShieldTile({ data }) {
  const [shields, setShields] = useState(data.streak?.streak_shields_available || 0);
  const [busy, setBusy] = useState(false);
  const sound = useGameSound();
  const buy = async () => {
    setBusy(true);
    try {
      const r = await gamificationApi.buyShield();
      if (r.ok) { setShields(r.streak_shields_available); sound("streak"); }
      else alert(r.message || "Couldn't buy a shield.");
    } catch { /* ignore */ } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center justify-between rounded-3xl border border-white/60 bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-slate-800/70">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-500 dark:bg-amber-500/15"><Shield className="h-6 w-6" /></span>
        <div>
          <p className="font-extrabold text-slate-800 dark:text-white">Streak Shields · {shields}</p>
          <p className="text-xs font-semibold text-slate-400">Protects your streak for one missed day (300 XP)</p>
        </div>
      </div>
      <button onClick={buy} disabled={busy}
        className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-extrabold text-white shadow disabled:opacity-50">
        {busy ? "…" : "Buy"}
      </button>
    </div>
  );
}

/* ============================================================ JUNIOR (1–4) */

function JuniorDashboard({ user, data, onReload, onOpenNotes }) {
  const sound = useGameSound();
  const [pet, setPet] = useState(data.companion);
  const [mascot, setMascot] = useState("idle");
  const [line, setLine] = useState("");

  const interact = async (type, item) => {
    setMascot(type === "feed" ? "celebrating" : "idle");
    try {
      const r = await gamificationApi.companion(type, item);
      setPet((p) => ({ ...p, pet_level: r.pet_level, friendship: r.friendship_points, hunger: r.hunger_level }));
      setLine(r.tuto_vocal_response);
      sound(type === "feed" ? "star" : "pop");
    } catch { /* ignore */ }
    setTimeout(() => { setMascot("idle"); setLine(""); }, 4000);
  };

  return (
    <div className="space-y-6">
      {/* Star + streak header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-400 p-6 text-white shadow-xl">
        <div>
          <p className="text-sm font-bold text-white/90">👋 Welcome back, {user.name.split(" ")[0]}!</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-black"><Star className="h-7 w-7 fill-white" /> {data.magic_stars} Stars</h1>
          <p className="mt-1 text-sm font-bold text-white/90">Level {data.current_level} · {data.rank}</p>
        </div>
        <StreakFlame streakDays={data.streak?.days || 0} isJunior />
      </div>

      {/* Companion pet */}
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-indigo-100 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <TutoMascot state={mascot} line={line} size={110} onTap={() => { setLine("Hi! Ready to learn? 🦉"); setTimeout(() => setLine(""), 3000); }} />
          <div className="text-center sm:text-left">
            <p className="text-lg font-extrabold text-slate-800 dark:text-white">{pet?.pet_name || "Tuto"} · Lvl {pet?.pet_level || 1}</p>
            <Meter label="Hunger" value={pet?.hunger ?? 100} tint="bg-rose-400" />
            <Meter label="Friendship" value={Math.min(100, pet?.friendship ?? 0)} tint="bg-pink-400" />
          </div>
        </div>
        <div className="flex gap-3">
          <PetBtn onClick={() => interact("feed", "star_cookie")} icon={Cookie} label="Feed" />
          <PetBtn onClick={() => interact("pat")} icon={Heart} label="Pat" />
        </div>
      </div>

      {/* Two big paths (spec §6.1) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <BigPath onClick={() => { sound("pop"); onOpenNotes?.(); }} emoji="📘" title="Read My Notes" tint="from-indigo-500 to-violet-500" />
        <BigPath onClick={() => sound("star")} emoji="🧩" title="Play Games" tint="from-emerald-500 to-teal-500" />
      </div>

      {/* Sticker book */}
      <StickerCanvas />
    </div>
  );
}

/* ----------------------------------------------------------------- bits */

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="text-center">
      <span className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-white/20"><Icon className="h-4 w-4" /></span>
      <p className="mt-1 text-lg font-black leading-none">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/80">{label}</p>
    </div>
  );
}

function ActionTile({ onClick, icon: Icon, title, sub, tint }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-4 rounded-3xl bg-gradient-to-br ${tint} p-5 text-left text-white shadow-lg transition-all hover:-translate-y-0.5`}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20"><Icon className="h-6 w-6" /></span>
      <div><p className="text-lg font-extrabold">{title}</p><p className="text-sm text-white/85">{sub}</p></div>
    </button>
  );
}

function BigPath({ onClick, emoji, title, tint }) {
  return (
    <button onClick={onClick}
      className={`flex items-center justify-center gap-3 rounded-3xl bg-gradient-to-br ${tint} p-8 text-2xl font-black text-white shadow-lg transition-transform hover:-translate-y-1`}>
      <span className="text-3xl">{emoji}</span> {title}
    </button>
  );
}

function PetBtn({ onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-2xl bg-indigo-50 px-5 py-3 font-extrabold text-indigo-600 shadow-sm transition-transform hover:-translate-y-0.5 active:scale-95 dark:bg-indigo-500/15 dark:text-indigo-300">
      <Icon className="h-6 w-6" /> <span className="text-xs">{label}</span>
    </button>
  );
}

function Meter({ label, value, tint }) {
  return (
    <div className="mt-1.5 w-44 max-w-full">
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wide text-slate-400"><span>{label}</span><span>{value}%</span></div>
      <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <div className={`h-full rounded-full ${tint} transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
