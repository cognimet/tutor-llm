import React, { useEffect, useState } from "react";
import { Backdrop, AppHeader, Spinner } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { authApi, curriculumApi, progressApi } from "../../api/endpoints.js";
import CreditMeter from "../../ui/CreditMeter.jsx";
import StudentHome from "./StudentHome.jsx";
import TutorChat from "./TutorChat.jsx";
import NotebookHub from "./NotebookHub.jsx";

export default function StudentApp() {
  const { user, logout, patchUser } = useAuth();
  const [view, setView] = useState("home"); // home | chat | notebooks
  const [subjects, setSubjects] = useState([]);
  const [curriculum, setCurriculum] = useState({ level: null, path: null });
  const [progress, setProgress] = useState(null);
  const [session, setSession] = useState(null); // active chat { id, subject, chapter, topic }
  const [loading, setLoading] = useState(true);

  const loadProgress = async () => {
    try { setProgress(await progressApi.summary()); } catch { /* ignore */ }
  };

  const loadCurriculum = async () => {
    try {
      const data = await curriculumApi.mine();
      setSubjects(data.subjects || []);
      setCurriculum({ level: data.level, path: data.path });
    } catch { /* ignore */ }
  };

  useEffect(() => {
    (async () => {
      try { await Promise.all([loadCurriculum(), loadProgress()]); }
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

  const openTopic = (payload) => { setSession(payload); setView("chat"); };
  const backHome = () => { setView("home"); setSession(null); loadProgress(); };

  return (
    <div className={view === "chat" ? "h-screen" : "min-h-screen"}>
      <Backdrop />
      {/* Chat has its own single, combined header — skip the global bar there. */}
      {view !== "chat" && <AppHeader user={user} onLogout={logout} right={<CreditMeter />} />}
      {loading ? (
        <Spinner label="Loading your classroom…" />
      ) : view === "notebooks" ? (
        <NotebookHub
          subjects={subjects}
          onBack={backHome}
          onStudy={(s) => openTopic({
            topic_name: s.name, subject_name: s.name, tint: s.tint, emoji: s.emoji, from_notes: true,
          })}
        />
      ) : view === "home" ? (
        <StudentHome
          user={user}
          path={curriculum.path}
          subjects={subjects}
          progress={progress}
          onOpenTopic={openTopic}
          onOpenNotebooks={() => setView("notebooks")}
          onRefresh={loadProgress}
          onSetLevel={setLevel}
        />
      ) : (
        <TutorChat user={user} session={session} onBack={backHome} onLogout={logout} onProgressChange={loadProgress} />
      )}
    </div>
  );
}
