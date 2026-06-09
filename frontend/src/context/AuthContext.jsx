import React, { createContext, useContext, useEffect, useState } from "react";
import { authApi } from "../api/endpoints.js";
import { getToken, setToken } from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on load if a token exists.
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          setUser(await authApi.me());
        } catch {
          setToken(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (payload) => {
    const { user, token } = await authApi.login(payload);
    setToken(token);
    setUser(user);
    return user;
  };

  const register = async (payload) => {
    const { user, token } = await authApi.register(payload);
    setToken(token);
    setUser(user);
    return user;
  };

  const logout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    setToken(null);
    setUser(null);
  };

  const patchUser = (partial) => setUser((u) => ({ ...u, ...partial }));

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, patchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
