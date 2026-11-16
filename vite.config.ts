import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://justinbuzzer.github.io/wine-cellar/ (and /wine-cellar/ locally).
export default defineConfig({
  base: "/wine-cellar/",
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
