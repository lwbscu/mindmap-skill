import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, "app"),
  base: "./",
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: false,
    fs: { allow: [root] }
  },
  build: {
    target: "es2022",
    outDir: path.join(root, "dist", "app"),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1600
  }
});
