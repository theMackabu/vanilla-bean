import fs from "node:fs";
import { transformSync } from "@babel/core";
import jsxTransformPkg from "@babel/plugin-transform-react-jsx";
import tsTransformPkg from "@babel/plugin-transform-typescript";
import signals from "./signals.ts";
import thunkPlugin from "./jsx-thunk.ts";
import className from "./class-name.ts";
import directives from "./directives.ts";
import autoJsxRuntime from "./auto-runtime.ts";
import ctxThread from "./ctx.ts";
import { setScanner, recordExports } from "./manifest.ts";

const jsxTransform = (jsxTransformPkg as any).default ?? jsxTransformPkg;
const tsTransform = (tsTransformPkg as any).default ?? tsTransformPkg;

const DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use (?:server|client|static)["']/;
const EMPTY = { ctx: new Set<string>(), known: new Set<string>(), defaultCtx: false, defaultKnown: false };

function scanFile(absFile: string, mode: string): void {
  const code = fs.readFileSync(absFile, "utf8");
  const jsx = /\.[jt]sx$/.test(absFile);
  const directed = !jsx && /\.[jt]s$/.test(absFile) && !absFile.includes("/node_modules/") && DIRECTIVE.test(code);
  if (!jsx && !directed) {
    recordExports(mode, absFile, { ...EMPTY, ctx: new Set(), known: new Set() });
    return;
  }
  const ts = /\.tsx?$/.test(absFile);
  const browser = mode === "b";
  const plugins: any[] = [
    signals,
    thunkPlugin,
    className,
    [directives, { server: !browser, browser }],
    [jsxTransform, { runtime: "classic", pragma: "h", pragmaFrag: "Fragment" }],
    [autoJsxRuntime, { source: "vanilla-bean" }],
    [ctxThread, { scan: true, mode }],
  ];
  if (ts) plugins.unshift([tsTransform, { isTSX: /\.tsx$/.test(absFile), allowDeclareFields: true }]);
  transformSync(code, { filename: absFile, babelrc: false, configFile: false, plugins });
}

setScanner(scanFile);
