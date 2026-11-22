import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/my-repo-radar/",
  publicDir: false,
  plugins: [react()],
  build: { outDir: "../dist-web", emptyOutDir: true, assetsInlineLimit: 0 },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
