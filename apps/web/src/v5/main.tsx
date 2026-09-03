// Entry point for the V5 one-character slice shell (`world.html`).
// The sealed research-v4 study keeps its own entry at `src/main.tsx`.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";

import { SliceApp } from "./SliceApp";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <SliceApp />
  </StrictMode>,
);
