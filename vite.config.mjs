import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => ({
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
        new URL("./src/duckdbBundles.cdn.js", import.meta.url),
      ),
    },
  },
  worker: {
    format: "es",
  },
  plugins: [react()],
}));
