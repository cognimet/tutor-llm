import axios from "axios";

// Axios instance pointed at the Laravel API (proxied via Vite in dev).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: { Accept: "application/json" },
});

const TOKEN_KEY = "tuto_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Attach bearer token on every request.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear token so the app falls back to the auth screen.
// On 402 (out of AI credits), nudge any mounted credit meter to refresh.
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) setToken(null);
    if (error.response?.status === 402) {
      window.dispatchEvent(new CustomEvent("usage:refresh"));
    }
    return Promise.reject(error);
  }
);

export default api;
