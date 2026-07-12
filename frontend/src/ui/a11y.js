/**
 * Accessibility preferences: font size, dyslexia-friendly type, high contrast.
 *
 * Stored in localStorage and applied as classes on <html> (mirroring the theme
 * mechanism), so they style every screen without threading props. index.html
 * applies the saved value before first paint; this module owns changes at runtime.
 */
const KEY = "tuto_a11y";

export const A11Y_DEFAULTS = { fontScale: "base", dyslexic: false, highContrast: false };

export function getA11y() {
  try { return { ...A11Y_DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch { return { ...A11Y_DEFAULTS }; }
}

export function applyA11y(prefs = getA11y()) {
  const el = document.documentElement;
  el.classList.toggle("font-lg", prefs.fontScale === "lg");
  el.classList.toggle("font-xl", prefs.fontScale === "xl");
  el.classList.toggle("dyslexic", !!prefs.dyslexic);
  el.classList.toggle("high-contrast", !!prefs.highContrast);
}

export function setA11y(patch) {
  const next = { ...getA11y(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  applyA11y(next);
  return next;
}
