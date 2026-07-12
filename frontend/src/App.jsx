import React, { Suspense, lazy } from "react";
import { useAuth } from "./context/AuthContext.jsx";
import { Backdrop, Spinner } from "./ui/components.jsx";
import AuthScreen from "./screens/AuthScreen.jsx";

// Role apps are lazy: a student never downloads the school admin panel (and
// vice versa) — each role gets its own bundle chunk.
const StudentApp      = lazy(() => import("./screens/student/StudentApp.jsx"));
const ParentDashboard = lazy(() => import("./screens/parent/ParentDashboard.jsx"));
const AdminPanel      = lazy(() => import("./screens/admin/AdminPanel.jsx"));
const TeacherApp      = lazy(() => import("./screens/teacher/TeacherApp.jsx"));
const SchoolApp       = lazy(() => import("./screens/school/SchoolApp.jsx"));

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen"><Backdrop /><Spinner label="Starting Tuto.ai…" /></div>
    );
  }

  if (!user) return <AuthScreen />;

  // Role-based routing.
  const roleApp = {
    student:      <StudentApp />,
    parent:       <ParentDashboard />,
    admin:        <AdminPanel />,
    teacher:      <TeacherApp />,
    school_admin: <SchoolApp />,
  }[user.role];

  if (!roleApp) return <AuthScreen />;

  return (
    <Suspense fallback={<div className="min-h-screen"><Backdrop /><Spinner label="Opening your classroom…" /></div>}>
      {roleApp}
    </Suspense>
  );
}
