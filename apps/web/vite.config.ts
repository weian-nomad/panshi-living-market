import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

import { v5ApiMiddleware } from "./tools/v5-api-middleware.mjs";

const SEALED_STUDY_BUILD_ID = "study-2026-07-23.5";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "");
  if (mode === "production" && environment.VITE_STUDY_BUILD_ID !== SEALED_STUDY_BUILD_ID) {
    throw new Error(`Production build requires VITE_STUDY_BUILD_ID=${SEALED_STUDY_BUILD_ID}`);
  }

  return {
    plugins: [react(), v5ApiMiddleware()],
    // No SPA fallback: an unknown path must 404 instead of silently landing in
    // whichever app owns `index.html`. The two shells are addressed explicitly
    // by `v5ApiMiddleware` (dev/preview) and by `deploy/study/Caddyfile`
    // (release image).
    appType: "mpa",
    server: {
      port: 4173,
    },
    build: {
      rollupOptions: {
        // Two documents, two public mount points:
        // - `index.html` is the sealed research-v4 study, served at `/study*`
        //   and `/research`. Its filename is pinned by
        //   `tools/study-release-audit.mjs` and by the sealed service worker
        //   (`public/study-sw.js` caches `/index.html`), so the document keeps
        //   its name and only its public address moves.
        // - `world.html` is the V5 slice shell, served at `/`, `/world` and
        //   `/people/*`.
        input: {
          study: "index.html",
          world: "world.html",
        },
      },
    },
  };
});
