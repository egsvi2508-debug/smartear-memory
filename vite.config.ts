import { defineConfig } from "vite";

// Relative base so the built site works from any subpath (GitHub Pages).
export default defineConfig({
  base: "./",
  build: { chunkSizeWarningLimit: 700 },
});
