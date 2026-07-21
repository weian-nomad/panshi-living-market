/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STUDY_BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
