import { defineConfig } from "vitest/config";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d"],
  },
  test: {
    environment: "node",
    server: {
      deps: {
        inline: ["@dimforge/rapier3d"],
      },
    },
  },
});
