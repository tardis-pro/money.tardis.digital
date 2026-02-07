import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "esnext",
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
