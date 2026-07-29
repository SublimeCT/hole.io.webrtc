import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    migrate: "src/db/migrate.ts",
  },
  clean: true,
  dts: false,
  format: ["esm"],
  minify: false,
  noExternal: ["@hole-io/shared"],
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  platform: "node",
  sourcemap: false,
  splitting: false,
  target: "node22",
});
