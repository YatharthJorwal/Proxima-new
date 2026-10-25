// Builds the React dashboard into dist/ui/ (loaded by src/electron/main.ts).
// base "./" keeps every asset URL relative so the page works from file://.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
    emptyOutDir: true,
    target: "chrome120",
    chunkSizeWarningLimit: 1200,
  },
});
