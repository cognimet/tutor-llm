import React, { useEffect, useState } from "react";
import { Backdrop, AppHeader, Card, Spinner } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { adminApi } from "../../api/endpoints.js";
import { Users, GraduationCap, BookOpen, MessageCircle, ClipboardCheck, Search, Power } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import CurriculumManager from "./CurriculumManager.jsx";
import UserDrawer from "./UserDrawer.jsx";
import CreditsPanel from "./CreditsPanel.jsx";
import GapAnalytics from "./GapAnalytics.jsx";

export default function AdminPanel() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => { try { setData(await adminApi.stats()); } finally { setLoading(false); } })(); }, []);

  return (
    <div className="min-h-screen">
      <Backdrop />
      <AppHeader user={user} onLogout={logout} right={
        <div className="hidden gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200 sm:flex">
          {["overview", "users", "curriculum", "credits", "gaps"].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-xl px-3 py-1.5 text-sm font-extrabold capitalize ${tab === t ? "bg-indigo-500 text-white" : "text-slate-500"}`}>{t}</button>
          ))}
        </div>
      } />
      <div className="mx-auto max-w-6xl px-5 py-8">
        {tab === "overview"
          ? (loading ? <Spinner label="Loading admin console…" /> : <Overview data={data} />)
          : tab === "users" ? <UsersTab />
          : tab === "credits" ? <CreditsPanel />
          : tab === "gaps" ? <GapAnalytics />
          : <CurriculumManager />}
      </div>
    </div>
  );
}

function Overview({ data }) {
  const s = data.stats;
  const cards = [
    { icon: GraduationCap, label: "Students", value: s.students, tint: "indigo" },
    { icon: Users, label: "Parents", value: s.parents, tint: "emerald" },
    { icon: BookOpen, label: "Subjects", value: s.subjects, tint: "amber" },
    { icon: MessageCircle, label: "Chat sessions", value: s.chat_sessions, tint: "sky" },
    { icon: ClipboardCheck, label: "Assessments", value: s.assessments, tint: "rose" },
    { icon: ClipboardCheck, label: "Avg score", value: s.avg_score, tint: "violet" },
  ];
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">Platform overview</h1>
      <p className="text-slate-500">A live snapshot of Everything AI Tutor.</p>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className={`grid h-10 w-10 place-items-center rounded-2xl bg-${c.tint}-50 text-${c.tint}-600`}><c.icon className="h-5 w-5" /></div>
            <p className="mt-3 text-2xl font-extrabold text-slate-900">{c.value}</p>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{c.label}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6 p-5">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Signups by day</p>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.signups_by_day}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} /><Tooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}

function UsersTab() {
  const [users, setUsers] = useState(null);
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const [drawerUser, setDrawerUser] = useState(null);

  const load = async () => setUsers(await adminApi.users({ role: role || undefined, search: search || undefined }));
  useEffect(() => { load(); }, [role]);

  const toggleActive = async (e, u) => {
    e.stopPropagation();
    const updated = await adminApi.setActive(u.id, !u.is_active);
    setUsers((d) => ({ ...d, data: d.data.map((x) => (x.id === u.id ? { ...x, ...updated } : x)) }));
  };

  const handleSaved = (updated) => {
    setUsers((d) => d ? { ...d, data: d.data.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)) } : d);
  };

  const ROLE_BADGE = {
    student: "bg-indigo-50 text-indigo-600",
    parent:  "bg-emerald-50 text-emerald-600",
    admin:   "bg-amber-50 text-amber-600",
  };

  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">Users</h1>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search name or email… (Enter)"
            className="w-full rounded-2xl border border-slate-200 bg-white/80 py-3 pl-11 pr-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200" />
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold outline-none">
          <option value="">All roles</option><option value="student">Students</option><option value="parent">Parents</option><option value="admin">Admins</option>
        </select>
      </div>

      <Card className="mt-5 overflow-hidden">
        {!users ? <Spinner /> : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Curriculum</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setDrawerUser(u)}
                  className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-indigo-50/40"
                >
                  <td className="px-5 py-3">
                    <p className="font-extrabold text-slate-800">{u.name}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold capitalize ${ROLE_BADGE[u.role] ?? "bg-slate-50 text-slate-500"}`}>{u.role}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{u.curriculum_path || (u.grade ? `Class ${u.grade}` : "—")}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${u.is_active ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                      {u.is_active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={(e) => toggleActive(e, u)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                    >
                      <Power className="h-3.5 w-3.5" /> {u.is_active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {drawerUser && (
        <UserDrawer
          user={drawerUser}
          onClose={() => setDrawerUser(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
