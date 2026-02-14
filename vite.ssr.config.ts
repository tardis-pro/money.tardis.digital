import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

export default defineConfig({
  plugins: [svelte()],
  root: "src/terminal",
  build: {
    outDir: "../../dist/server",
    ssr: true,
    rollupOptions: {
      input: resolve(__dirname, "src/terminal/server-entry.ts"),
    },
  },
  ssr: {
    noExternal: ["svelte"],
  },
});
