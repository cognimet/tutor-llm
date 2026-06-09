import React from "react";
import { useAuth } from "./context/AuthContext.jsx";
import { Backdrop, Spinner } from "./ui/components.jsx";
import AuthScreen from "./screens/AuthScreen.jsx";
import StudentApp from "./screens/student/StudentApp.jsx";
import ParentDashboard from "./screens/parent/ParentDashboard.jsx";
import AdminPanel from "./screens/admin/AdminPanel.jsx";

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
    case "student": return <StudentApp />;
    case "parent":  return <ParentDashboard />;
    case "admin":   return <AdminPanel />;
    default:        return <AuthScreen />;
  }
}
