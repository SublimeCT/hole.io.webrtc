import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({
  base,
  publicDir: "../../assets",
  plugins: [wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d"],
  },
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/@dimforge/rapier3d/") || id.includes("/@dimforge+rapier3d@")) {
            return "physics";
          }
          if (id.includes("/three/")) {
            return "three";
          }
          return undefined;
        },
      },
    },
  },
});
