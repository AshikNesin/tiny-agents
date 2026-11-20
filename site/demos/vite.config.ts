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
