import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  resolve: {
    alias: {
      "@duckdb-bundles": fileURLToPath(
        new URL(command === "build" ? "./src/duckdbBundles.cdn.js" : "./src/duckdbBundles.local.js", import.meta.url),
      ),
    },
  },
  worker: {
    format: "es",
  },
  plugins: [react()],
}));
