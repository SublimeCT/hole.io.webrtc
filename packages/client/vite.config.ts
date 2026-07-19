import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "../../assets",
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
