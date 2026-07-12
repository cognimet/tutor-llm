import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Force a SINGLE copy of React/Router across the app and every lazy chunk.
  // Without this, a stale dep-optimizer cache (e.g. after a package.json change)
  // can load React twice, causing "Invalid hook call / Cannot read useRef".
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom"],
  },
  server: {
    port: 5173,
    // Allow the dev server to be reached via a temporary tunnel domain
    // (cloudflared / ngrok / VS Code port-forward). Dev-only convenience.
    allowedHosts: true,
    // The dev server's pre-bundled dep chunks carry a version hash (?v=…) that
    // changes whenever dependencies change. If the browser caches them, a later
    // deploy can mix old + new chunks → two copies of React → "Invalid hook
    // call" / blank page (seen in Chrome but not a freshly-cached Brave). Tell
    // browsers never to cache dev-server responses so they always fetch the
    // current graph. (The real prod fix is serving the built bundle — see
    // Dockerfile.prod — where assets are content-hashed and this can't happen.)
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      // Proxy API calls to the Laravel backend in dev.
      // In Docker this is set to http://backend:8000 via VITE_PROXY_TARGET.
      "/api": {
        target: process.env.VITE_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
