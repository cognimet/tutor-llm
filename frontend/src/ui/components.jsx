import React, { useEffect, useRef, useState } from "react";
import { Sparkles, LogOut, Moon, Sun, UserRound, ChevronDown } from "lucide-react";
import { useTheme } from "../context/ThemeContext.jsx";

// Friendly educational preset avatars — a child with no photo can still pick a
// learning-themed face. Stored on the user as "preset:<key>"; uploads store a URL.
export const PRESET_AVATARS = {
  graduate: "🎓", books: "📚", pencil: "✏️", lightbulb: "💡", brain: "🧠",
  microscope: "🔬", telescope: "🔭", atom: "⚛️", globe: "🌍", abacus: "🧮",
};

// Render whatever's stored in `avatar`: a preset emoji, an uploaded image, or a
// fallback initial. Shared so the navbar and profile page show the same face.
export function AvatarBubble({ avatar, name, className = "" }) {
  const preset = typeof avatar === "string" && avatar.startsWith("preset:") ? avatar.slice(7) : null;
  if (avatar && !preset) {
    return <img src={avatar} alt={name || "Profile picture"} className={`object-cover ${className}`} />;
  }
  if (preset && PRESET_AVATARS[preset]) {
    return <span className={`grid place-items-center ${className}`}>{PRESET_AVATARS[preset]}</span>;
  }
  return (
    <span className={`grid place-items-center bg-indigo-100 font-extrabold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300 ${className}`}>
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-indigo-300/40 blur-3xl dark:bg-indigo-500/20" />
      <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-rose-300/40 blur-3xl dark:bg-fuchsia-500/15" />
      <div className="absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-amber-200/50 blur-3xl dark:bg-violet-500/15" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(99,102,241,0.08)_1px,transparent_0)] [background-size:22px_22px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.10)_1px,transparent_0)]" />
    </div>
  );
}

/** Light/dark toggle — drop anywhere; reads & flips the global theme. */
export function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle dark mode"
      className={`grid h-9 w-9 place-items-center rounded-xl bg-white/70 text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-indigo-600 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10 dark:hover:text-indigo-300 ${className}`}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function Logo({ onClick, subtitle = "Study Buddy" }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 select-none transition-transform hover:scale-[1.02]">
      <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-lg text-white shadow-lg shadow-indigo-500/30">🦉</div>
      <div className="text-left leading-tight">
        <p className="font-display font-extrabold tracking-tight text-slate-800 dark:text-white">Tuto<span className="text-indigo-500 dark:text-indigo-300">.ai</span></p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{subtitle}</p>
      </div>
    </button>
  );
}

export function Button({ children, variant = "primary", className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-2xl font-extrabold transition-all active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100";
  const styles = {
    primary: "bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 px-5 py-3",
    ghost: "bg-white/70 text-slate-700 ring-1 ring-slate-200 hover:bg-white px-5 py-3",
    soft: "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-5 py-3",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props}>{children}</button>;
}

export function Badge({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-indigo-600 ring-1 ring-indigo-100 ${className}`}>
      <Sparkles className="h-3.5 w-3.5" /> {children}
    </span>
  );
}

export function Card({ children, className = "" }) {
  return <div className={`rounded-3xl border border-white/60 bg-white/75 shadow-lg shadow-slate-200/40 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 dark:shadow-black/20 ${className}`}>{children}</div>;
}

export function AppHeader({ user, onLogout, onProfile, right }) {
  const roleLabel = { admin: "Admin", student: "Student", parent: "Parent" }[user?.role] || "";
  return (
    <header className="sticky top-0 z-20 border-b border-white/40 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Logo subtitle={roleLabel} />
        <div className="flex items-center gap-3">
          {right}
          <ThemeToggle />
          <UserMenu user={user} onProfile={onProfile} onLogout={onLogout} />
        </div>
      </div>
    </header>
  );
}

/**
 * Account dropdown for the navbar. The avatar + name is the trigger; clicking it
 * opens a small menu with "My Profile" (when available) and "Log out". Closes on
 * outside-click or Escape, so it's comfortable for both desktop and mobile.
 */
export function UserMenu({ user, onProfile, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (fn) => () => { setOpen(false); fn?.(); };

  const itemCls = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-xl bg-white/70 py-1.5 pl-1.5 pr-2.5 ring-1 ring-slate-200 transition hover:ring-indigo-300 dark:bg-white/5 dark:ring-white/10 dark:hover:ring-indigo-400/40"
      >
        <span className="grid h-7 w-7 shrink-0 overflow-hidden rounded-lg text-base">
          <AvatarBubble avatar={user?.avatar} name={user?.name} className="h-full w-full text-base" />
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-bold text-slate-700 dark:text-slate-200 sm:block">{user?.name}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="msg-in absolute right-0 top-full z-30 mt-2 w-52 origin-top-right rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl shadow-slate-900/10 dark:border-white/10 dark:bg-slate-800"
        >
          {/* Who's signed in */}
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <span className="grid h-9 w-9 shrink-0 overflow-hidden rounded-xl text-lg ring-1 ring-slate-100 dark:ring-white/10">
              <AvatarBubble avatar={user?.avatar} name={user?.name} className="h-full w-full text-lg" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{user?.name}</p>
              {roleSub(user) && <p className="truncate text-xs text-slate-400">{roleSub(user)}</p>}
            </div>
          </div>
          <div className="my-1 h-px bg-slate-100 dark:bg-white/10" />

          {onProfile && (
            <button role="menuitem" onClick={run(onProfile)} className={`${itemCls} text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 dark:text-slate-200 dark:hover:bg-indigo-500/10`}>
              <UserRound className="h-4 w-4" /> My Profile
            </button>
          )}
          <button role="menuitem" onClick={run(onLogout)} className={`${itemCls} text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10`}>
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

// Small secondary line under the name in the menu: email if present, else role.
function roleSub(user) {
  if (user?.email) return user.email;
  return { admin: "Admin", student: "Student", parent: "Parent" }[user?.role] || "";
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500 dark:border-slate-700 dark:border-t-indigo-400" />
      <span className="font-bold">{label}</span>
    </div>
  );
}
