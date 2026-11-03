// Builds the site's Stageshow demos into site/assets/, so the site itself
// stays a static folder with no build step: run `pnpm site:build` after
// editing anything under site/demos/ and commit site/assets/.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  publicDir: false,
  base: "./",
  plugins: [react()],
  build: {
    outDir: here("../assets"),
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    rollupOptions: {
      input: here("main.tsx"),
      output: {
        format: "es",
        entryFileNames: "demos.js",
        chunkFileNames: "demos-[name].js",
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith(".css")) ? "demos.css" : "[name]-[hash][extname]",
      },
    },
  },
});
