import React from "react";
import { useAuth } from "./context/AuthContext.jsx";
import { Backdrop, Spinner } from "./ui/components.jsx";
import AuthScreen from "./screens/AuthScreen.jsx";
import StudentApp from "./screens/student/StudentApp.jsx";
import ParentDashboard from "./screens/parent/ParentDashboard.jsx";
import AdminPanel from "./screens/admin/AdminPanel.jsx";
import TeacherApp from "./screens/teacher/TeacherApp.jsx";
import SchoolApp from "./screens/school/SchoolApp.jsx";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen"><Backdrop /><Spinner label="Starting Tuto.ai…" /></div>
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
