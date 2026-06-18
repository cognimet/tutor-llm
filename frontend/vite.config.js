import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow the dev server to be reached via a temporary tunnel domain
    // (cloudflared / ngrok / VS Code port-forward). Dev-only convenience.
    allowedHosts: true,
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
