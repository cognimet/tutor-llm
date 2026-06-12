import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * App-wide light/dark theme.
 *
 * - Defaults to the OS preference, then remembers the user's manual choice in
 *   localStorage ("tuto_theme").
 * - Applies/removes the `dark` class on <html> (Tailwind `darkMode: "class"`)
 *   and sets `color-scheme` so native controls (scrollbars, form fields) match.
 * - While no manual choice is stored, it keeps following the OS in real time.
 */
const ThemeContext = createContext({ theme: "light", toggle: () => {}, setTheme: () => {} });
const STORAGE_KEY = "tuto_theme";

function getInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage unavailable */ }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function apply(theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitial);

  useEffect(() => { apply(theme); }, [theme]);

  // Follow the OS while the user hasn't made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return undefined;
    const onChange = (e) => {
      try { if (localStorage.getItem(STORAGE_KEY)) return; } catch { /* ignore */ }
      setThemeState(e.matches ? "dark" : "light");
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const setTheme = useCallback((next) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
