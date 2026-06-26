import { h, claim, collectAdopt, clearHead, flushHead, withCursor, type Component } from "./dom.ts";
import { ErrorBoundary } from "./suspense.ts";
import { makeSignal, createOwner, runWithOwner, dispose, type Owner } from "./reactive.ts";
import { isRedirect } from "./request.ts";
import { makeCtx, type Ctx, type Loc } from "./ctx.ts";
import { setRendering } from "./guard.ts";

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

type Chain = {
  layouts: Component[];
  page: Component | null;
  ErrorComp: Component | null;
  notFound: boolean;
  serverRoute: boolean;
  serverStart: number | null;
  cache: boolean;
  params: Record<string, unknown>;
};

const pageModules = import.meta.glob("/src/pages/**/*.{js,jsx,ts,tsx}");
const layoutModules = import.meta.glob("/src/**/layout.{js,jsx,ts,tsx}");
const notFoundModules = import.meta.glob("/src/**/not-found.{js,jsx,ts,tsx}");
const errorModules = import.meta.glob("/src/**/error-page.{js,jsx,ts,tsx}");

const SPECIAL = /\/(layout|not-found|error-page)\.[jt]sx?$/;
const SCORE: Record<string, number> = { static: 3, dynamic: 2, catch: 1, optcatch: 0 };

export const routes: Record<string, Loader> = {};
const routeFile: Record<string, string> = {};
const dynamicRoutes: DynamicRoute[] = [];

function parsePattern(file: string): Part[] {
  const rel = file
    .replace(/^\/src\/pages/, "")
    .replace(/\.[jt]sx?$/, "")
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
const layoutDirs = dirMap(layoutModules, /\/layout\.[jt]sx?$/);
const notFoundDirs = dirMap(notFoundModules, /\/not-found\.[jt]sx?$/);
const errorDirs = dirMap(errorModules, /\/error-page\.[jt]sx?$/);

function fileToPath(file: string): string {
  const p = file
    .replace(/^\/src\/pages/, "")
    .replace(/\.[jt]sx?$/, "")
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
  const params = m ? m.params : {};

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

  const serverMods = [...layoutMods, pageMod];
  const serverStart = serverMods.findIndex((mm) => mm && mm.__serverRoute);
  const serverRoute = serverStart !== -1;
  const cache = layoutMods.every((mm) => mm?.cache !== false) && pageMod?.cache !== false;

  return {
    layouts: layoutMods.map((mm) => mm.default),
    page: pageMod ? pageMod.default : null,
    ErrorComp: errMod ? errMod.default : null,
    notFound: !known,
    serverRoute,
    serverStart: serverRoute ? serverStart : null,
    cache,
    params,
  };
}

function buildPage(ctx: Ctx, chain: Chain, props: Loc, path: string, reset: () => void): Node {
  const { page, ErrorComp } = chain;
  const make = () => (page ? h(ctx, page, props) : ctx.doc.createTextNode(`404: no page for ${path}`));
  if (!ErrorComp) return make() as Node;
  return h(ctx, ErrorBoundary, { fallback: (error: unknown) => h(ctx, ErrorComp, { error, reset }) }, make) as Node;
}

function snapshot(ctx: Ctx): Loc {
  const u = ctx.url;
  return {
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    search: u.search,
    hash: u.hash,
    params: ctx.matchedParams,
  };
}

export function useLocation(ctx: Ctx): Loc {
  return ctx.loc!(ctx);
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

let clientCtx: Ctx = null as any;

export function start(config: Record<string, unknown> = {}): void {
  const ctx = makeCtx(document, (globalThis as any).Node, { url: new URL(location.href) });
  clientCtx = ctx;

  ctx.transitions = !!(config as any).transitions;
  ctx.rootEl = document.getElementById("root");
  ctx.loc = makeSignal(snapshot(ctx));
  const tag = document.getElementById("_vanilla_static");

  if (tag) {
    try {
      setStaticData(JSON.parse(tag.textContent || "{}"));
    } catch {}
  }

  collectAdopt(ctx);
  const here = () => location.pathname + location.search + location.hash;
  go(ctx, here(), false);
  window.addEventListener("popstate", () => go(ctx, here(), false));
  document.addEventListener("click", (e) => onLinkClick(ctx, e as MouseEvent));
  document.addEventListener("pointerover", (e) => onLinkHover(ctx, e));
}

const prefetched = new Set<string>();
function onLinkHover(_ctx: Ctx, e: Event): void {
  const a = (e.target as Element)?.closest?.("a");
  if (!a || (a as HTMLAnchorElement).target || a.hasAttribute("download")) return;
  const href = a.getAttribute("href");
  if (!href) return;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || prefetched.has(url.pathname) || !matchRoute(url.pathname)) return;
  prefetched.add(url.pathname);
  loadChain(url.pathname).catch(() => prefetched.delete(url.pathname));
}

function onLinkClick(ctx: Ctx, e: MouseEvent): void {
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
  if (target !== location.pathname + location.search + location.hash) go(ctx, target, true);
}

async function go(ctx: Ctx, href: string, push: boolean): Promise<void> {
  const url = new URL(href, location.href);
  const chain = await loadChain(url.pathname);
  const navPromise = ctx.booted && chain.serverRoute ? fetchNav(url) : null;

  if (ctx.booted && url.pathname + url.search === location.pathname + location.search) {
    if (navPromise) {
      const nav = await navPromise;
      if (nav.redirect) return navigate(nav.redirect, { replace: true });
      if (nav.islands) fillServerIslands(ctx, nav.islands);
    }
    return;
  }

  const apply = () => {
    if (push) history.pushState({}, "", url.pathname + url.search + url.hash);
    ctx.url = url;
    ctx.matchedParams = chain.params;
    ctx.loc!(ctx, snapshot(ctx));
    clearHead(ctx);
    try {
      if (!ctx.booted) hydrateBoot(ctx, chain, url.pathname);
      else swap(ctx, chain, url.pathname);
    } catch (e) {
      if (isRedirect(e)) return navigate((e as any).redirect.url, { replace: true });
      throw e;
    }
    flushHead(ctx);
  };

  if (ctx.transitions && (document as any).startViewTransition) (document as any).startViewTransition(apply);
  else apply();

  if (navPromise) {
    const target = url.pathname + url.search;
    try {
      const nav = await navPromise;
      if (nav.redirect) {
        navigate(nav.redirect, { replace: true });
        return;
      }
      if (nav.islands && location.pathname + location.search === target) fillServerIslands(ctx, nav.islands);
    } catch {
      location.href = url.pathname + url.search + url.hash;
    }
  }
}

function fillServerIslands(ctx: Ctx, islands: Map<string, string>): void {
  for (const [key, html] of islands) {
    const el = ctx.doc.querySelector(`island[data-mode="server"][data-key="${key}"]`);
    if (el) el.innerHTML = html;
  }
}

const NAV_MIME = "application/vnd.vanilla-bean.nav+json";
async function fetchNav(url: URL): Promise<{ islands?: Map<string, string>; redirect?: string }> {
  const res = await fetch(url.pathname + url.search, { headers: { accept: NAV_MIME } });
  if (!res.ok) throw new Error("nav " + res.status);
  const payload = (await res.json()) as { islands?: Record<string, string>; redirect?: string };
  if (payload.redirect) return { redirect: payload.redirect };
  return { islands: new Map(Object.entries(payload.islands || {})) };
}

export function navigate(href: string, { replace = false }: { replace?: boolean } = {}): void {
  const ctx = clientCtx;
  if (!ctx || typeof location === "undefined") return;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) {
    location.href = href;
    return;
  }
  const target = url.pathname + url.search + url.hash;
  if (replace) {
    history.replaceState({}, "", target);
    go(ctx, target, false);
  } else {
    go(ctx, target, true);
  }
}

function patchParams(ctx: Ctx, mutate: (sp: URLSearchParams) => void, replace: boolean): void {
  if (!ctx || typeof location === "undefined") return;
  const url = new URL(location.href);
  mutate(url.searchParams);
  history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + url.search + url.hash);
  ctx.url = url;
  ctx.loc!(ctx, snapshot(ctx));
}

(navigate as any).params = {
  get: (key: string) => (typeof location === "undefined" ? null : new URL(location.href).searchParams.get(key)),
  has: (key: string) => typeof location !== "undefined" && new URL(location.href).searchParams.has(key),
  set: (key: string, value: unknown, { replace = true }: { replace?: boolean } = {}) =>
    patchParams(clientCtx, (sp) => (value == null ? sp.delete(key) : sp.set(key, String(value))), replace),
  delete: (key: string, { replace = true }: { replace?: boolean } = {}) =>
    patchParams(clientCtx, (sp) => sp.delete(key), replace),
};

function createOutlet(ctx: Ctx): HTMLElement {
  const d = ctx.doc.createElement("div");
  d.style.display = "contents";
  return d;
}

function buildLayered(ctx: Ctx, chain: Chain, path: string, reset: () => void): Node {
  ctx.mounted = [];
  const build = (i: number): Node => {
    if (i >= chain.layouts.length) {
      ctx.pageOwner = createOwner();
      return runWithOwner(ctx, ctx.pageOwner, () => buildPage(ctx, chain, { ...ctx.loc!(ctx) }, path, reset));
    }
    const owner = createOwner();
    let outlet!: HTMLElement;
    const slot = () => {
      outlet = (claim(ctx, "div") as HTMLElement | null) ?? createOutlet(ctx);
      withCursor(ctx, outlet.firstChild, () => {
        const inner = build(i + 1);
        if (inner instanceof ctx.Node && (inner as Node).parentNode !== outlet) outlet.appendChild(inner as Node);
      });
      return outlet;
    };
    const node = runWithOwner(ctx, owner, () => h(ctx, chain.layouts[i]!, null, slot)) as Node;
    ctx.mounted.push({ Comp: chain.layouts[i]!, outlet, owner });
    return node;
  };
  return build(0);
}

function hydrateBoot(ctx: Ctx, chain: Chain, path: string): void {
  ctx.booted = true;
  const reset = () => go(ctx, location.pathname + location.search + location.hash, false);
  const wasEmpty = !ctx.rootEl!.firstChild;
  const tree = withCursor(ctx, ctx.rootEl!.firstChild, () => buildLayered(ctx, chain, path, reset));
  if (wasEmpty) ctx.rootEl!.replaceChildren(tree as Node);
}

function swap(ctx: Ctx, chain: Chain, path: string): void {
  const { layouts } = chain;
  const mounted = ctx.mounted;
  let k = 0;

  while (k < mounted.length && k < layouts.length && mounted[k]!.Comp === layouts[k]) k++;
  if (chain.serverStart != null) k = Math.min(k, chain.serverStart);

  dispose(ctx.pageOwner);
  ctx.pageOwner = null;
  for (let i = k; i < mounted.length; i++) dispose(mounted[i]!.owner);
  ctx.mounted = mounted.slice(0, k);

  const parentOutlet = k === 0 ? ctx.rootEl! : ctx.mounted[k - 1]!.outlet;
  const layers: { Comp: Component; outlet: HTMLElement; owner: Owner }[] = [];
  for (let i = k; i < layouts.length; i++) {
    const outlet = ctx.doc.createElement("div");
    outlet.style.display = "contents";
    layers.push({ Comp: layouts[i]!, outlet, owner: createOwner() });
  }

  const reset = () => go(ctx, location.pathname + location.search + location.hash, false);
  ctx.pageOwner = createOwner();
  let child: any = runWithOwner(ctx, ctx.pageOwner, () => buildPage(ctx, chain, { ...ctx.loc!(ctx) }, path, reset));
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    layer.outlet.replaceChildren(child);
    child = runWithOwner(ctx, layer.owner, () => h(ctx, layer.Comp, null, layer.outlet));
  }
  if (k === 0) parentOutlet.replaceChildren(ctx.doc.createComment("app"), child);
  else parentOutlet.replaceChildren(child);
  ctx.mounted = ctx.mounted.concat(layers);
}

export async function renderRouteToDocument(ctx: Ctx, path: string): Promise<{ cache: boolean }> {
  clearHead(ctx);
  const chain = await loadChain(path);
  ctx.matchedParams = chain.params;
  ctx.loc = makeSignal(snapshot(ctx));
  setRendering(true);
  try {
    const tree = buildLayered(ctx, chain, path, () => {});
    ctx.doc.getElementById("root")!.replaceChildren(tree as Node);
  } finally {
    setRendering(false);
  }
  flushHead(ctx);
  return { cache: chain.cache };
}
