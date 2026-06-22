import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Backdrop, AppHeader, Spinner } from "../../ui/components.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { authApi, curriculumApi, progressApi } from "../../api/endpoints.js";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import CreditMeter from "../../ui/CreditMeter.jsx";
import StudentHome from "./StudentHome.jsx";
import TutorChat from "./TutorChat.jsx";
import NotebookHub from "./NotebookHub.jsx";
import GamificationDashboard from "./GamificationDashboard.jsx";

export default function StudentApp() {
  const { user, logout, patchUser } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The page is now the URL (/, /chat, /notebooks). The active chat's topic
  // context is still kept per-user so a reload of /chat resumes that topic.
  const [session, setSession] = usePersistedState(`tuto:student:session:${user.id}`, null);
  const [subjects, setSubjects] = useState([]);
  const [curriculum, setCurriculum] = useState({ level: null, path: null });
  const [progress, setProgress] = useState(null);
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

  const openTopic = (payload) => { setSession(payload); navigate("/chat"); };
  const backHome = () => { setSession(null); navigate("/"); loadProgress(); };

  const isChat = pathname === "/chat";

  return (
    <div className={isChat ? "h-screen" : "min-h-screen"}>
      <Backdrop />
      {/* Chat has its own single, combined header — skip the global bar there. */}
      {!isChat && <AppHeader user={user} onLogout={logout} right={<CreditMeter />} />}
      {loading ? (
        <Spinner label="Loading your classroom…" />
      ) : (
        <Routes>
          <Route index element={
            <StudentHome
              user={user}
              path={curriculum.path}
              subjects={subjects}
              progress={progress}
              onOpenTopic={openTopic}
              onOpenNotebooks={() => navigate("/notebooks")}
              onOpenRewards={() => navigate("/rewards")}
              onRefresh={loadProgress}
              onSetLevel={setLevel}
            />
          } />
          <Route path="notebooks" element={
            <NotebookHub
              subjects={subjects}
              onBack={backHome}
              onStudy={(s) => openTopic({
                topic_id: s.topic_id || null,
                topic_name: s.topic_name || s.name,
                subject_name: s.subject_name || s.name,
                chapter_name: s.chapter_name || null,
                tint: s.tint,
                emoji: s.emoji,
                // Syllabus-Quest launches set from_notes:false; note + Smart-Drop
                // launches are note-grounded (default true when unspecified).
                from_notes: s.from_notes ?? true,
                selected_note_ids: s.selected_note_ids || [],
                // Carry the launcher's teaching style + companion persona so the
                // chat opens in that mode and the backend persists the vibe.
                quest_style: s.quest_style || "teach",
                tutor_vibe: s.tutor_vibe || "coach",
              })}
            />
          } />
          <Route path="rewards" element={
            <GamificationDashboard
              user={user}
              onBack={backHome}
              onOpenNotes={() => navigate("/notebooks")}
            />
          } />
          <Route path="chat" element={
            session
              ? <TutorChat user={user} session={session} onBack={backHome} onLogout={logout} onProgressChange={loadProgress} />
              : <Navigate to="/" replace />
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </div>
  );
}
