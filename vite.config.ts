import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Writes dist/sw.js from sw/sw.js with this build's file list and version. */
function serviceWorker(): Plugin {
  return {
    name: "wine-cellar-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map") && f !== "index.html")
        .sort();
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      const source = readFileSync(new URL("./sw/sw.js", import.meta.url), "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// Served from https://justinbuzzer.github.io/wine-cellar/ (and /wine-cellar/ locally).
export default defineConfig({
  base: "/wine-cellar/",
  plugins: [react(), serviceWorker()],
  server: { port: 5173, strictPort: true },
});
