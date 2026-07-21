import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const SEALED_STUDY_BUILD_ID = "study-2026-07-21.1";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "");
  if (mode === "production" && environment.VITE_STUDY_BUILD_ID !== SEALED_STUDY_BUILD_ID) {
    throw new Error(`Production build requires VITE_STUDY_BUILD_ID=${SEALED_STUDY_BUILD_ID}`);
  }

  return {
    plugins: [react()],
    server: {
      port: 4173,
    },
  };
});
