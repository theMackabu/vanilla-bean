import { transformAsync } from "@babel/core";
import jsxTransformPkg from "@babel/plugin-transform-react-jsx";
import tsTransformPkg from "@babel/plugin-transform-typescript";
import signals from "../babel/signals.ts";
import thunkPlugin from "../babel/jsx-thunk.ts";
import directives from "../babel/directives.ts";
import autoJsxRuntime from "../babel/auto-runtime.ts";
import type { Ctx } from "./index.ts";

const jsxTransform = (jsxTransformPkg as any).default ?? jsxTransformPkg;
const tsTransform = (tsTransformPkg as any).default ?? tsTransformPkg;

export function jsxPlugin(ctx: Ctx): any {
  return {
    name: "framework:jsx",
    enforce: "pre",
    async transform(code: string, id: string, opts: any) {
      const file = id.split("?")[0];
      if (!/\.[jt]sx$/.test(file)) return null;
      const ts = /\.tsx$/.test(file);
      const browser = !ctx.ssrBuild && !opts?.ssr;
      const plugins: any[] = [
        signals,
        thunkPlugin,
        [directives, { server: ctx.ssrBuild, browser }],
        [jsxTransform, { runtime: "classic", pragma: "h", pragmaFrag: "Fragment" }],
        [autoJsxRuntime, { source: "vanilla-bean" }],
      ];
      if (ts) plugins.unshift([tsTransform, { isTSX: true, allowDeclareFields: true }]);
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
