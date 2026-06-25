import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vite: "src/build/vite/index.ts",
    cli: "src/build/cli.ts",
    server: "src/server/server.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  splitting: false,
  shims: false,
});
