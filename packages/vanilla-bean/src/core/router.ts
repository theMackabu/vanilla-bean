import { h, collectAdopt, clearHead, flushHead, withCursor, type Component } from "./dom.ts";
import { ErrorBoundary } from "./suspense.ts";
import { makeSignal } from "./reactive.ts";

type Loader = () => Promise<any>;

type Part =
  | {
      type: "static";
      value: string;
    }
  | {
      type: "dynamic" | "catch" | "optcatch";
      name: string;
    };

type DynamicRoute = {
  file: string;
  loader: Loader;
  parts: Part[];
};

type Loc = {
  path: string;
  query: Record<string, string>;
  search: string;
  hash: string;
  params: Record<string, unknown>;
};

type Chain = {
  layouts: Component[];
  page: Component | null;
  ErrorComp: Component | null;
  notFound: boolean;
  serverRoute: boolean;
};

const pageModules = import.meta.glob("/src/pages/**/*.{jsx,tsx}");
const layoutModules = import.meta.glob("/src/**/layout.{jsx,tsx}");
const notFoundModules = import.meta.glob("/src/**/not-found.{jsx,tsx}");
const errorModules = import.meta.glob("/src/**/error-page.{jsx,tsx}");

const SPECIAL = /\/(layout|not-found|error-page)\.[jt]sx$/;
const SCORE: Record<string, number> = { static: 3, dynamic: 2, catch: 1, optcatch: 0 };

export const routes: Record<string, Loader> = {};
const routeFile: Record<string, string> = {};
const dynamicRoutes: DynamicRoute[] = [];

function parsePattern(file: string): Part[] {
  const rel = file
    .replace(/^\/src\/pages/, "")
    .replace(/\.[jt]sx$/, "")
    .replace(/\/index$/, "");
  return rel
    .split("/")
    .filter(Boolean)
    .map((seg): Part => {
      let m: RegExpMatchArray | null;
      if ((m = seg.match(/^\[\[\.\.\.(.+)\]\]$/))) return { type: "optcatch", name: m[1]! };
      if ((m = seg.match(/^\[\.\.\.(.+)\]$/))) return { type: "catch", name: m[1]! };
      if ((m = seg.match(/^\[(.+)\]$/))) return { type: "dynamic", name: m[1]! };
      return { type: "static", value: seg };
    });
}

for (const file in pageModules) {
  if (SPECIAL.test(file)) continue;
  const parts = parsePattern(file);
  if (parts.every((p) => p.type === "static")) {
    const p = fileToPath(file);
    routes[p] = pageModules[file]!;
    routeFile[p] = file;
  } else {
    dynamicRoutes.push({ file, loader: pageModules[file]!, parts });
  }
}
dynamicRoutes.sort((a, b) => {
  const n = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < n; i++) {
    const sa = a.parts[i] ? SCORE[a.parts[i]!.type]! : -1;
    const sb = b.parts[i] ? SCORE[b.parts[i]!.type]! : -1;
    if (sa !== sb) return sb - sa;
  }
  return 0;
});

const dirMap = (modules: Record<string, Loader>, suffix: RegExp): Record<string, Loader> => {
  const out: Record<string, Loader> = {};
  for (const file in modules) out[file.replace(suffix, "")] = modules[file]!;
  return out;
};
const layoutDirs = dirMap(layoutModules, /\/layout\.[jt]sx$/);
const notFoundDirs = dirMap(notFoundModules, /\/not-found\.[jt]sx$/);
const errorDirs = dirMap(errorModules, /\/error-page\.[jt]sx$/);

function fileToPath(file: string): string {
  const p = file
    .replace(/^\/src\/pages/, "")
    .replace(/\.[jt]sx$/, "")
    .replace(/\/index$/, "");
  return p === "" ? "/" : p;
}

export function matchRoute(pathname: string): { file: string; loader: Loader; params: Record<string, unknown> } | null {
  if (pathname in routes) return { file: routeFile[pathname]!, loader: routes[pathname]!, params: {} };
  let segs = pathname.split("/").filter(Boolean);
  try {
    segs = segs.map(decodeURIComponent);
  } catch {}
  for (const r of dynamicRoutes) {
    const params = matchParts(r.parts, segs);
    if (params) return { file: r.file, loader: r.loader, params };
  }
  return null;
}

function matchParts(parts: Part[], segs: string[]): Record<string, unknown> | null {
  const params: Record<string, unknown> = {};
  let i = 0;
  for (const part of parts) {
    if (part.type === "static") {
      if (segs[i] !== part.value) return null;
      i++;
    } else if (part.type === "dynamic") {
      if (i >= segs.length) return null;
      params[part.name] = segs[i++];
    } else if (part.type === "catch") {
      if (i >= segs.length) return null;
      params[part.name] = segs.slice(i);
      i = segs.length;
    } else {
      params[part.name] = segs.slice(i);
      i = segs.length;
    }
  }
  return i === segs.length ? params : null;
}

const dirToUrl = (dir: string): string => dir.replace(/^\/src\/pages/, "").replace(/^\/src$/, "");

function layoutLoadersForFile(file: string): Loader[] {
  const dir = file.slice(0, file.lastIndexOf("/"));
  return Object.keys(layoutDirs)
    .filter((d) => dir === d || dir.startsWith(d + "/"))
    .sort((a, b) => a.length - b.length)
    .map((d) => layoutDirs[d]!);
}

function nearestDir(dirs: Record<string, Loader>, urlPath: string): string | null {
  let best: string | null = null;
  let bestRank = [-1, -1];
  for (const dir in dirs) {
    const prefix = dirToUrl(dir);
    const owns = prefix === "" || urlPath === prefix || urlPath.startsWith(prefix + "/");
    if (!owns) continue;
    const rank = [prefix.length, dir.length];
    if (rank[0]! > bestRank[0]! || (rank[0] === bestRank[0] && rank[1]! > bestRank[1]!)) {
      best = dir;
      bestRank = rank;
    }
  }
  return best;
}

async function loadChain(path: string): Promise<Chain> {
  const m = matchRoute(path);
  matchedParams = m ? m.params : {};
  const known = !!m;
  const nfDir = known ? null : nearestDir(notFoundDirs, path);
  const baseFile = known ? m!.file : nfDir ? nfDir + "/not-found.jsx" : "/src/pages/_.jsx";
  const errDir = nearestDir(errorDirs, path);

  const load = (loader: Loader | null): Promise<any> => (loader ? loader() : Promise.resolve(null));
  const [layoutMods, pageMod, errMod] = await Promise.all([
    Promise.all(layoutLoadersForFile(baseFile).map((l) => l())),
    load(known ? m!.loader : nfDir ? notFoundDirs[nfDir]! : null),
    load(errDir ? errorDirs[errDir]! : null),
  ]);
  const serverRoute = [pageMod, ...layoutMods].some((mm) => mm && mm.__serverRoute);
  return {
    layouts: layoutMods.map((mm) => mm.default),
    page: pageMod ? pageMod.default : null,
    ErrorComp: errMod ? errMod.default : null,
    notFound: !known,
    serverRoute,
  };
}

function buildPage(chain: Chain, props: Loc, path: string, reset: () => void): Node {
  const { page, ErrorComp } = chain;
  const make = () => (page ? h(page, props) : document.createTextNode(`404: no page for ${path}`));
  if (!ErrorComp) return make();
  return h(ErrorBoundary, { fallback: (error: unknown) => h(ErrorComp, { error, reset }) }, make);
}

let matchedParams: Record<string, unknown> = {};

function snapshot(): Loc {
  if (typeof location === "undefined") return { path: "/", query: {}, search: "", hash: "", params: {} };
  const u = new URL(location.href);
  return {
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    search: u.search,
    hash: u.hash,
    params: matchedParams,
  };
}

let loc = makeSignal<Loc>(snapshot());
export function useLocation(): Loc {
  return loc();
}

const staticRegistry = new Map<string, () => unknown>();
let staticData: Record<string, unknown> = {};

export function __static(key: string, fn: () => unknown): () => unknown {
  staticRegistry.set(key, fn);
  return () => staticData[key];
}
export function setStaticData(data: Record<string, unknown>): void {
  staticData = data || {};
}
export async function preloadAll(): Promise<void> {
  const loaders = new Set<Loader>();
  const add = (loader: Loader | null | undefined): void => {
    if (loader) loaders.add(loader);
  };

  for (const path in routes) {
    const file = routeFile[path]!;
    for (const loader of layoutLoadersForFile(file)) add(loader);
    add(routes[path]);
    const errDir = nearestDir(errorDirs, path);
    add(errDir ? errorDirs[errDir] : null);
  }
  for (const r of dynamicRoutes) {
    add(r.loader);
    for (const loader of layoutLoadersForFile(r.file)) add(loader);
  }
  for (const dir in notFoundDirs) add(notFoundDirs[dir]);
  for (const dir in errorDirs) add(errorDirs[dir]);

  await Promise.all([...loaders].map((loader) => loader()));
}
export async function collectStatics(): Promise<Record<string, unknown>> {
  for (const [key, fn] of staticRegistry) {
    if (!(key in staticData)) staticData[key] = await fn();
  }
  return staticData;
}

let rootEl: HTMLElement | null = null;
let mounted: { Comp: Component; outlet: HTMLElement }[] = [];
let booted = false;
let options: { transitions?: boolean } = { transitions: false };

export function start(config: Record<string, unknown> = {}): void {
  options = { ...options, ...config };
  rootEl = document.getElementById("root");
  const tag = document.getElementById("_vanilla_static");
  if (tag) {
    try {
      setStaticData(JSON.parse(tag.textContent || "{}"));
    } catch {}
  }
  collectAdopt();
  const here = () => location.pathname + location.search + location.hash;
  go(here(), false);
  window.addEventListener("popstate", () => go(here(), false));
  document.addEventListener("click", onLinkClick);
  document.addEventListener("pointerover", onLinkHover);
}

const prefetched = new Set<string>();
function onLinkHover(e: Event): void {
  const a = (e.target as Element)?.closest?.("a");
  if (!a || (a as HTMLAnchorElement).target || a.hasAttribute("download")) return;
  const href = a.getAttribute("href");
  if (!href) return;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || prefetched.has(url.pathname) || !matchRoute(url.pathname)) return;
  prefetched.add(url.pathname);
  loadChain(url.pathname).catch(() => prefetched.delete(url.pathname));
}

function onLinkClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest("a") as HTMLAnchorElement | null;
  if (!a || a.target || a.hasAttribute("download")) return;
  const href = a.getAttribute("href");
  if (!href) return;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return;
  if (!matchRoute(url.pathname)) return;
  e.preventDefault();
  const target = url.pathname + url.search + url.hash;
  if (target !== location.pathname + location.search + location.hash) go(target, true);
}

async function go(href: string, push: boolean): Promise<void> {
  const url = new URL(href, location.href);
  const chain = await loadChain(url.pathname);
  if (booted && chain.serverRoute) {
    location.href = url.pathname + url.search + url.hash;
    return;
  }
  const apply = () => {
    if (push) history.pushState({}, "", url.pathname + url.search + url.hash);
    loc(snapshot());
    clearHead();
    if (!booted) hydrateBoot(chain, url.pathname);
    else swap(chain, url.pathname);
    flushHead();
  };
  if (options.transitions && (document as any).startViewTransition) (document as any).startViewTransition(apply);
  else apply();
}

export function navigate(href: string, { replace = false }: { replace?: boolean } = {}): void {
  if (typeof location === "undefined") return;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) {
    location.href = href;
    return;
  }
  const target = url.pathname + url.search + url.hash;
  if (replace) {
    history.replaceState({}, "", target);
    go(target, false);
  } else {
    go(target, true);
  }
}

function patchParams(mutate: (sp: URLSearchParams) => void, replace: boolean): void {
  if (typeof location === "undefined") return;
  const url = new URL(location.href);
  mutate(url.searchParams);
  history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + url.search + url.hash);
  loc(snapshot());
}

(navigate as any).params = {
  get: (key: string) => (typeof location === "undefined" ? null : new URL(location.href).searchParams.get(key)),
  has: (key: string) => typeof location !== "undefined" && new URL(location.href).searchParams.has(key),
  set: (key: string, value: unknown, { replace = true }: { replace?: boolean } = {}) =>
    patchParams((sp) => (value == null ? sp.delete(key) : sp.set(key, String(value))), replace),
  delete: (key: string, { replace = true }: { replace?: boolean } = {}) => patchParams((sp) => sp.delete(key), replace),
};

function hydrateBoot(chain: Chain, path: string): void {
  booted = true;
  const reset = () => go(location.pathname + location.search + location.hash, false);
  const build = (i: number): unknown =>
    i < chain.layouts.length
      ? h(chain.layouts[i]!, null, () => build(i + 1))
      : buildPage(chain, { ...loc() }, path, reset);
  withCursor(rootEl!.firstChild, () => build(0));
  mounted = [];
}

function swap(chain: Chain, path: string): void {
  const { layouts } = chain;
  let k = 0;
  while (k < mounted.length && k < layouts.length && mounted[k]!.Comp === layouts[k]) k++;
  mounted = mounted.slice(0, k);

  const parentOutlet = k === 0 ? rootEl! : mounted[k - 1]!.outlet;
  const layers: { Comp: Component; outlet: HTMLElement }[] = [];
  for (let i = k; i < layouts.length; i++) {
    const outlet = document.createElement("div");
    outlet.style.display = "contents";
    layers.push({ Comp: layouts[i]!, outlet });
  }

  const reset = () => go(location.pathname + location.search + location.hash, false);
  let child: any = buildPage(chain, { ...loc() }, path, reset);
  for (let i = layers.length - 1; i >= 0; i--) {
    layers[i]!.outlet.replaceChildren(child);
    child = h(layers[i]!.Comp, null, layers[i]!.outlet);
  }
  if (k === 0) parentOutlet.replaceChildren(document.createComment("app"), child);
  else parentOutlet.replaceChildren(child);
  mounted = mounted.concat(layers);
}

export async function renderRouteToDocument(path: string): Promise<void> {
  clearHead();
  const chain = await loadChain(path);
  loc = makeSignal<Loc>(snapshot());
  const node = buildPage(chain, { ...loc() }, path, () => {});
  const tree = chain.layouts.reduceRight((child: any, Layout) => h(Layout, null, child), node as any);
  document.getElementById("root")!.replaceChildren(tree);
  flushHead();
}
