import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vite: "src/build/vite/index.ts",
    cli: "src/build/cli.ts",
    client: "src/client.ts",
    server: "src/server/server.ts",
    "api-routes": "src/server/api-routes.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  splitting: false,
  shims: false,
  external: ["vanilla-bean", "virtual:framework-config"],
});
