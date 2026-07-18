import React from "react";
import { useAuth } from "./context/AuthContext.jsx";
import { Backdrop, LogoMark, Spinner } from "./ui/components.jsx";
import AuthScreen from "./screens/AuthScreen.jsx";
import StudentApp from "./screens/student/StudentApp.jsx";
import ParentDashboard from "./screens/parent/ParentDashboard.jsx";
import AdminPanel from "./screens/admin/AdminPanel.jsx";
import TeacherApp from "./screens/teacher/TeacherApp.jsx";
import SchoolApp from "./screens/school/SchoolApp.jsx";

// NOTE: role apps are STATICALLY imported (not React.lazy). Lazy code-splitting
// only pays off with a production build (content-hashed chunks); on the Vite
// dev server it creates a separate async chunk that, across a dep re-optimize,
// can resolve a SECOND copy of React → "Invalid hook call / blank page". Keep
// this static until the frontend is served as a built bundle (Dockerfile.prod),
// at which point lazy loading is safe to reintroduce.
export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      // Branded boot screen — the mark is the first thing the app paints.
      <div className="min-h-screen">
        <Backdrop />
        <div className="flex min-h-screen flex-col items-center justify-center gap-1">
          <LogoMark className="h-16 w-16 animate-pulse" />
          <p className="font-display text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            tutor<span className="text-blue-600 dark:text-blue-400">LLM</span>
          </p>
          <Spinner label="Starting tutorLLM…" />
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  // Role-based routing.
  switch (user.role) {
    case "student":      return <StudentApp />;
    case "parent":       return <ParentDashboard />;
    case "admin":        return <AdminPanel />;
    case "teacher":      return <TeacherApp />;
    case "school_admin": return <SchoolApp />;
    default:             return <AuthScreen />;
  }
}
