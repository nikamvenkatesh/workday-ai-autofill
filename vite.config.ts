import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import manifest from "./manifest.config";

const root = dirname(fileURLToPath(import.meta.url));

function copyPdfWorker() {
  return {
    name: "copy-pdf-worker",
    buildStart() {
      const from = resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
      const toDir = resolve(root, "public");
      const to = resolve(toDir, "pdf.worker.min.mjs");
      if (!existsSync(from)) return;
      if (!existsSync(toDir)) mkdirSync(toDir, { recursive: true });
      copyFileSync(from, to);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyPdfWorker(), crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
