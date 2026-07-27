import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({
  base,
  publicDir: "../../assets",
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/cannon-es/")) {
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
