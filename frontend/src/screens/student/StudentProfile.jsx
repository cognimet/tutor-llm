import React, { useRef, useState } from "react";
import { ArrowLeft, Camera, Check, Loader2, Sparkles } from "lucide-react";
import { Button, Card, AvatarBubble, PRESET_AVATARS } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { authApi } from "../../api/endpoints.js";
import CurriculumPicker from "../../ui/CurriculumPicker.jsx";

/**
 * My Profile — a simple, child-friendly page where a student manages their
 * name, email, mobile number, photo and class. Reuses CurriculumPicker (the
 * same guided picker as sign-up) so the class/board experience is identical.
 * AvatarBubble / PRESET_AVATARS are shared from the ui module so the navbar and
 * this page render the same face.
 */

export default function StudentProfile({ onBack }) {
  const { user, patchUser } = useAuth();
  const fileRef = useRef(null);

  const [name, setName] = useState(user.name || "");
  const [email, setEmail] = useState(user.email || "");
  const [mobile, setMobile] = useState(user.mobile || "");
  const [avatar, setAvatar] = useState(user.avatar || "");
  // Seed the curriculum picker from the current level; it emits a full path.
  const [curr, setCurr] = useState(
    user.level_id ? { level_id: user.level_id, stream: user.stream, board: user.board, grade: user.grade } : null
  );

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const pickPreset = (key) => setAvatar(`preset:${key}`);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const updated = await authApi.uploadAvatar(file);
      patchUser(updated);
      setAvatar(updated.avatar || "");
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't upload that picture — try a smaller JPG or PNG.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    setError("");
    if (!name.trim()) return setError("Please enter your name.");
    if (!email.trim()) return setError("Please enter your email.");
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim(),
        mobile: mobile.trim() || null,
        avatar: avatar || null,
        ...(curr ? { level_id: curr.level_id, stream: curr.stream, board: curr.board, grade: curr.grade } : {}),
      };
      const updated = await authApi.updateProfile(payload);
      patchUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't save your profile. Please check your details and try again.");
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-semibold text-slate-800 outline-none ring-indigo-200 placeholder:font-medium placeholder:text-slate-400 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-slate-100";
  const labelCls = "mb-1.5 block text-sm font-extrabold text-slate-700 dark:text-slate-200";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      {onBack && (
        <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-extrabold text-slate-500 hover:text-indigo-500">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}

      <div className="mb-6 flex items-center gap-3">
        <Sparkles className="h-7 w-7 text-indigo-500" />
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">My Profile</h1>
          <p className="text-sm text-slate-400">This is you! Keep your details up to date. 🌟</p>
        </div>
      </div>

      {/* Picture */}
      <Card className="mb-5 p-5">
        <p className={labelCls}>My Picture</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-20 w-20 overflow-hidden rounded-3xl text-4xl shadow-sm ring-2 ring-indigo-100 dark:ring-white/10">
            <AvatarBubble avatar={avatar} name={name} className="h-full w-full text-4xl" />
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onUpload} />
            <Button variant="soft" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload a photo"}
            </Button>
            <p className="mt-1 text-xs text-slate-400">JPG, PNG or WEBP, up to 4MB.</p>
          </div>
        </div>

        <p className="mt-4 mb-2 text-sm font-extrabold text-slate-600 dark:text-slate-300">…or pick a fun avatar</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESET_AVATARS).map(([key, emoji]) => {
            const active = avatar === `preset:${key}`;
            return (
              <button
                key={key}
                onClick={() => pickPreset(key)}
                aria-label={`Choose ${key} avatar`}
                className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl transition ${
                  active ? "bg-indigo-500 ring-2 ring-indigo-300" : "bg-slate-100 hover:bg-indigo-100 dark:bg-white/5"
                }`}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Details */}
      <Card className="mb-5 space-y-4 p-5">
        <div>
          <label className={labelCls} htmlFor="pf-name">Full Name</label>
          <input id="pf-name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div>
          <label className={labelCls} htmlFor="pf-email">Email Address</label>
          <input id="pf-email" type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className={labelCls} htmlFor="pf-mobile">Mobile Number</label>
          <input id="pf-mobile" type="tel" inputMode="tel" className={field} value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Optional" />
        </div>
      </Card>

      {/* Curriculum */}
      <Card className="mb-5 p-5">
        <p className={labelCls}>My Class</p>
        <p className="mb-3 text-xs text-slate-400">Pick your stage, board and class — the same as when you signed up.</p>
        <CurriculumPicker value={curr?.level_id} onChange={setCurr} />
      </Card>

      {error && <p className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600 dark:bg-rose-500/10">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? "Saving…" : "Save my profile"}
        </Button>
        {saved && <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-emerald-600"><Check className="h-4 w-4" /> Saved!</span>}
      </div>
    </div>
  );
}
