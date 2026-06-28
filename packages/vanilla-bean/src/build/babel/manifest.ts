import fs from "node:fs";
import path from "node:path";

export type FileExports = {
  ctx: Set<string>;
  known: Set<string>;
  actions: Set<string>;
  defaultCtx: boolean;
  defaultKnown: boolean;
};

const store = new Map<string, FileExports>();
const scanning = new Set<string>();
const EXTS = [".ts", ".tsx", ".js", ".jsx"];

const stripQuery = (f: string): string => {
  const q = f.indexOf("?");
  return q < 0 ? f : f.slice(0, q);
};
const keyOf = (mode: string, absFile: string): string => mode + "|" + stripQuery(absFile);

export function recordExports(mode: string, absFile: string, info: FileExports): void {
  store.set(keyOf(mode, absFile), info);
}

const resolveCache = new Map<string, string | null>();
export function resolveModule(importer: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const cacheKey = importer + "\0" + spec;
  const cached = resolveCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const base = path.resolve(path.dirname(stripQuery(importer)), spec);
  let found: string | null = null;
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, "index" + e))];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      found = c;
      break;
    }
  }
  resolveCache.set(cacheKey, found);
  return found;
}

export function lookupExport(mode: string, absFile: string, name: string): "ctx" | "plain" | "unknown" {
  const info = store.get(keyOf(mode, absFile));
  if (!info) return "unknown";
  if (name === "default") return info.defaultCtx ? "ctx" : info.defaultKnown ? "plain" : "unknown";
  if (info.ctx.has(name)) return "ctx";
  if (info.known.has(name)) return "plain";
  return "unknown";
}

export function lookupAction(mode: string, absFile: string, name: string): boolean {
  return store.get(keyOf(mode, absFile))?.actions.has(name) || false;
}

let scanner: ((absFile: string, mode: string) => void) | null = null;
export function setScanner(fn: (absFile: string, mode: string) => void): void {
  scanner = fn;
}
export function ensureScanned(absFile: string, mode: string): void {
  const k = keyOf(mode, absFile);
  if (store.has(k) || scanning.has(k) || !scanner) return;
  scanning.add(k);
  try {
    scanner(absFile, mode);
  } catch {
    // a file that fails to scan just stays "unknown"
  } finally {
    scanning.delete(k);
  }
}
