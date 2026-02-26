import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), svelte()],
  build: {
    target: "esnext",
    outDir: "dist/client",
  },
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src"),
    },
  },
  ssr: {
    noExternal: ["react", "react-dom", "react-router-dom"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
