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
    server: {
      port: 4173,
    },
    build: {
      rollupOptions: {
        // `study` is the sealed research-v4 entry; `world` is the V5 slice shell.
        input: {
          study: "index.html",
          world: "world.html",
        },
      },
    },
  };
});
