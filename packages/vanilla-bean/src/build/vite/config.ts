import type { Ctx } from "./index.ts";

export function runtimeConfigPlugin(ctx: Ctx): any {
  return {
    name: "framework:runtime-config",
    resolveId: (id: string) => (id === ctx.CONFIG_ID ? "\0" + ctx.CONFIG_ID : null),
    load: (id: string) => (id === "\0" + ctx.CONFIG_ID ? `export default ${JSON.stringify(ctx.runtime)};` : null),
  };
}

export function configPlugin(ctx: Ctx): any {
  return {
    name: "framework:config",
    config() {
      return {
        appType: "mpa",
        server: { port: 8343 },
        preview: { port: 7232 },
        oxc: { jsx: { runtime: "classic", pragma: "h", pragmaFrag: "Fragment" } },
        optimizeDeps: { noDiscovery: true, include: [] },
        resolve: { alias: [{ find: /^vanilla-bean$/, replacement: ctx.indexPath }] },
        ssr: { noExternal: ctx.ssrBuild ? true : ["vanilla-bean"] },
        build: ctx.ssrBuild
          ? {
              ssr: ctx.serverEntry,
              outDir: ".vanilla",
              emptyOutDir: false,
              rollupOptions: {
                output: { entryFileNames: "index.js", chunkFileNames: "server/[hash].js" },
              },
            }
          : {
              outDir: ".vanilla/dist",
              assetsDir: "_vanilla",
              rollupOptions: {
                input: { main: ctx.entryFile },
                output: {
                  entryFileNames: "_vanilla/[hash].js",
                  chunkFileNames: "_vanilla/[hash].js",
                  assetFileNames: "_vanilla/[hash][extname]",
                },
              },
            },
      };
    },
  };
}
