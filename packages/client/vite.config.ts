import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
// 仅 GitHub Pages 构建用仓库名前缀；自托管（nginx）部署用根路径。deploy-pages.yml 置 PAGES_BUILD=1。
const base = process.env.PAGES_BUILD === "1" && repositoryName ? `/${repositoryName}/` : "/";

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
