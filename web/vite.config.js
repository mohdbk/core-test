import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev server proxies the ai-engine API + WebSocket so the React app can
// talk to /api/* and /ws/* directly. WebRTC (MediaMTX on :8889) is consumed
// cross-origin via its own CORS config.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
