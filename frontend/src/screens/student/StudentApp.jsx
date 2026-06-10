import React, { useEffect, useState } from "react";
import { Home, ListChecks } from "lucide-react";
import { Backdrop, AppHeader, Spinner } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { authApi, curriculumApi, progressApi, planApi } from "../../api/endpoints.js";
import StudentHome from "./StudentHome.jsx";
import TutorChat from "./TutorChat.jsx";
import StudentPlans from "./StudentPlans.jsx";

export default function StudentApp() {
  const { user, logout, patchUser } = useAuth();
  const [view, setView] = useState("home"); // home | chat | plans
  const [subjects, setSubjects] = useState([]);
  const [curriculum, setCurriculum] = useState({ level: null, path: null });
  const [progress, setProgress] = useState(null);
  const [plans, setPlans] = useState([]);
  const [session, setSession] = useState(null); // active chat { id, subject, chapter, topic }
  const [loading, setLoading] = useState(true);

  const loadProgress = async () => {
    try { setProgress(await progressApi.summary()); } catch { /* ignore */ }
  };

  const loadPlans = async () => {
    try { setPlans(await planApi.index()); } catch { /* ignore */ }
  };

  // Progress and plans move together: closing a plan item can resolve a gap.
  const refresh = () => Promise.all([loadProgress(), loadPlans()]);

  const loadCurriculum = async () => {
    try {
      const data = await curriculumApi.mine();
      setSubjects(data.subjects || []);
      setCurriculum({ level: data.level, path: data.path });
    } catch { /* ignore */ }
  };

  useEffect(() => {
    (async () => {
      try { await Promise.all([loadCurriculum(), loadProgress(), loadPlans()]); }
      finally { setLoading(false); }
    })();
  }, []);

  // Student picks / changes their stage·board·level — persist + reload.
  const setLevel = async (sel) => {
    const updated = await authApi.updateProfile({
      level_id: sel.level_id, stream: sel.stream, board: sel.board, grade: sel.grade,
    });
    patchUser(updated);
    await loadCurriculum();
  };

  // Check a next-step item off (or back on); keep local state + progress in sync.
  const togglePlanItem = async (item) => {
    const updated = await planApi.toggleItem(item.id);
    setPlans((ps) => ps.map((p) => ({
      ...p,
      items: p.items.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)),
    })));
    loadProgress();
  };

  const openTopic = (payload) => { setSession(payload); setView("chat"); };

  // Make a next-step task actionable: quiz tasks open the mini-assessment;
  // learning tasks open the topic's tutor chat and auto-ask the AI to deliver it.
  const startTask = (item, topicName) => {
    const base = { topic_id: null, topic_name: topicName, tint: "indigo", emoji: "🎯" };
    const isQuiz = /\b(quiz|re-?take|assessment|test|mock)\b/i.test(item.title || "");
    if (isQuiz) {
      setSession({ ...base, autoAssess: true });
    } else {
      const mins = item.estimated_minutes || 5;
      const prompt =
        `I'm working on a next step for "${topicName}": "${item.title}"` +
        (item.detail ? ` — ${item.detail}.` : ".") +
        (item.concept ? ` Focus on the concept: ${item.concept}.` : "") +
        ` Please teach me this now in about ${mins} minutes — a clear step-by-step explanation,` +
        ` a worked example, and a quick check at the end.`;
      setSession({ ...base, initialMessage: prompt });
    }
    setView("chat");
  };

  const openPlans = () => setView("plans");
  const goHome = () => { setView("home"); setSession(null); refresh(); };
  const backHome = goHome;

  // Persistent top-nav so Home and Next steps are always reachable
  // (the chat view is full-screen and carries its own back button).
  const nav = view !== "chat" && !loading ? (
    <div className="flex items-center gap-1 rounded-2xl bg-white/70 p-1 ring-1 ring-slate-200">
      <NavBtn active={view === "home"} onClick={goHome} icon={Home}>Home</NavBtn>
      <NavBtn active={view === "plans"} onClick={openPlans} icon={ListChecks}>Next steps</NavBtn>
    </div>
  ) : null;

  return (
    <div className={view === "chat" ? "h-screen" : "min-h-screen"}>
      <Backdrop />
      <AppHeader user={user} onLogout={logout} right={nav} />
      {loading ? (
        <Spinner label="Loading your classroom…" />
      ) : view === "home" ? (
        <StudentHome
          user={user}
          path={curriculum.path}
          subjects={subjects}
          progress={progress}
          plans={plans}
          onOpenTopic={openTopic}
          onOpenPlans={openPlans}
          onTogglePlanItem={togglePlanItem}
          onStartTask={startTask}
          onRefresh={loadProgress}
          onSetLevel={setLevel}
        />
      ) : view === "plans" ? (
        <StudentPlans plans={plans} onBack={backHome} onToggleItem={togglePlanItem} onStartTask={startTask} />
      ) : (
        <TutorChat user={user} session={session} onBack={backHome} onProgressChange={refresh} />
      )}
    </div>
  );
}

function NavBtn({ active, onClick, icon: Icon, children }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-extrabold transition-colors ${active ? "bg-indigo-500 text-white shadow-sm" : "text-slate-500 hover:bg-white hover:text-indigo-600"}`}>
      <Icon className="h-4 w-4" /> <span className="hidden sm:inline">{children}</span>
    </button>
  );
}
