import { transformAsync } from "@babel/core";
import jsxTransformPkg from "@babel/plugin-transform-react-jsx";
import tsTransformPkg from "@babel/plugin-transform-typescript";
import signals from "../babel/signals.ts";
import thunkPlugin from "../babel/jsx-thunk.ts";
import className from "../babel/class-name.ts";
import directives from "../babel/directives.ts";
import autoJsxRuntime from "../babel/auto-runtime.ts";
import ctxThread from "../babel/ctx.ts";

import "../babel/scan.ts";
import type { Ctx } from "./index.ts";

const jsxTransform = (jsxTransformPkg as any).default ?? jsxTransformPkg;
const tsTransform = (tsTransformPkg as any).default ?? tsTransformPkg;
const DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use (?:server|client|static)["']/;

export function jsxPlugin(ctx: Ctx): any {
  return {
    name: "framework:jsx",
    enforce: "pre",
    async transform(code: string, id: string, opts: any) {
      const file = id.split("?")[0];
      const jsx = /\.[jt]sx$/.test(file);

      const local = !file.includes("/node_modules/");
      const directed = !jsx && /\.[jt]s$/.test(file) && local && DIRECTIVE.test(code);
      const isMiddleware = !jsx && /\/middleware\.[jt]s$/.test(file) && local;
      if (!jsx && !directed && !isMiddleware) return null;

      const ts = /\.tsx?$/.test(file);
      const browser = !ctx.ssrBuild && !opts?.ssr;

      const plugins: any[] = [
        signals,
        thunkPlugin,
        className,
        [directives, { server: !browser, browser }],
        [jsxTransform, { runtime: "classic", pragma: "h", pragmaFrag: "Fragment" }],
        [autoJsxRuntime, { source: "vanilla-bean" }],
        [ctxThread, { mode: browser ? "b" : "s" }],
      ];

      if (ts) plugins.unshift([tsTransform, { isTSX: /\.tsx$/.test(file), allowDeclareFields: true }]);

      const result = await transformAsync(code, {
        filename: id,
        sourceMaps: true,
        babelrc: false,
        configFile: false,
        plugins,
      });

      return { code: result!.code, map: result!.map };
    },
  };
}
