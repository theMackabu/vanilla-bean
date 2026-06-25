import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
export const c = chalk;

export const VERSION: string = (() => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  for (const pkg of [path.join(dir, "package.json"), path.join(dir, "..", "package.json")]) {
    try {
      const v = JSON.parse(fs.readFileSync(pkg, "utf8")).version;
      if (v) return v;
    } catch {}
  }
  return "?";
})();

export const brand = (cmd?: string, url?: string): string =>
  `\n  ${chalk.yellow.bold("●")} ${chalk.bold("Vanilla Bean")} ${chalk.dim("v" + VERSION)}` +
  (cmd ? ` ${chalk.green(cmd)}` : "") +
  (url ? ` ${chalk.cyan(url)}` : "") +
  "\n";

type AssetFile = {
  name: string;
  ext: string;
  size: number;
  gzip: number;
};

export function assetTable(out: unknown, outDir = "dist"): string {
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o: any) => o?.output || []);
  const kb = (n: number): string => (n / 1024).toFixed(2) + " kB";

  const files: AssetFile[] = outputs
    .map((f: any): AssetFile => {
      const data = f.type === "chunk" ? f.code : f.source;
      const buf = Buffer.from(typeof data === "string" ? data : data || []);
      return {
        name: `${outDir}/${f.fileName}`,
        ext: path.extname(f.fileName),
        size: buf.length,
        gzip: zlib.gzipSync(buf).length,
      };
    })
    .sort((a, b) => a.size - b.size);
  if (!files.length) return "";

  const namePad = Math.max(...files.map((f) => f.name.length));
  const sizePad = Math.max(...files.map((f) => kb(f.size).length));
  const gzPad = Math.max(...files.map((f) => kb(f.gzip).length));

  const tint = (ext: string) =>
    ext === ".css" ? c.magenta : ext === ".html" ? c.green : ext === ".js" ? c.cyan : c.yellow;

  return files
    .map((f) => {
      const slash = f.name.lastIndexOf("/");
      const name =
        c.dim(f.name.slice(0, slash + 1)) + tint(f.ext)(f.name.slice(slash + 1)) + " ".repeat(namePad - f.name.length);
      return `  ${name}  ${c.dim(kb(f.size).padStart(sizePad))} ${c.gray("│")} ${c.dim("gzip: " + kb(f.gzip).padStart(gzPad))}`;
    })
    .join("\n");
}
