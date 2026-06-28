import { apiRouteMeta, partsToPath, uniqueRoutes, type Part } from "./route-paths.ts";

type Loader = () => Promise<any>;
type Route = { load: Loader; file: string; path: string; parts: Part[]; module?: any };

const apiModules = import.meta.glob("/src/api/**/*.{js,jsx,ts,tsx}");
const wsModules = import.meta.glob("/src/api/**/*.ws.{js,jsx,ts,tsx}");

const apiTable: Route[] = uniqueRoutes(
  Object.entries(apiModules)
    .filter(([file]) => !/\.ws\.[jt]sx?$/.test(file))
    .map(([file, load]) => ({ load, ...apiRouteMeta(file, /\.[jt]sx?$/) })),
);

const wsTable: Route[] = uniqueRoutes(
  Object.entries(wsModules).map(([file, load]) => ({ load, module: null, ...apiRouteMeta(file, /\.ws\.[jt]sx?$/) })),
);

export const apiRoutes = apiTable.map(({ path, file }) => ({ path, file }));
export const wsRoutes = wsTable.map(({ path, file }) => ({ path, file }));

export async function preloadWs(): Promise<void> {
  for (const r of wsTable) r.module = await r.load();
}

export function matchWs(pathname: string): { module: any; params: Record<string, unknown> } | null {
  const segs = pathname.split("/").filter(Boolean);
  for (const r of wsTable) {
    const params = matchParts(r.parts, segs);
    if (params) return { module: r.module, params };
  }
  return null;
}

function matchParts(parts: Part[], segs: string[]): Record<string, unknown> | null {
  const params: Record<string, unknown> = {};
  let i = 0;
  for (const part of parts) {
    if (typeof part === "string") {
      if (segs[i] !== part) return null;
      i++;
    } else if ("param" in part) {
      if (i >= segs.length) return null;
      params[part.param] = decodeURIComponent(segs[i++]!);
    } else {
      if (i >= segs.length) return null;
      params[part.catch] = segs.slice(i).map(decodeURIComponent);
      i = segs.length;
    }
  }
  return i === segs.length ? params : null;
}

export function matchApi(pathname: string): { load: Loader; params: Record<string, unknown> } | null {
  const segs = pathname.split("/").filter(Boolean);
  for (const r of apiTable) {
    const params = matchParts(r.parts, segs);
    if (params) return { load: r.load, params };
  }
  return null;
}

export function toResponse(r: unknown): Response {
  if (r instanceof Response) return r;
  if (r == null) return new Response(null, { status: 204 });
  if (typeof r === "string") return new Response(r, { headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
}

export async function handleApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const match = matchApi(url.pathname);
  if (!match) return null;
  const mod = await match.load();
  const handler = mod[request.method] || (request.method === "GET" ? mod.default : null);
  if (!handler) return new Response("Method Not Allowed", { status: 405 });
  const ctx = { params: match.params, query: Object.fromEntries(url.searchParams), url };
  return toResponse(await handler(request, ctx));
}

function paramsFrom(parts: Part[], e: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of parts) {
    if (typeof p === "string") continue;
    if ("param" in p) out[p.param] = decodeURIComponent(e[p.param] ?? "");
    else
      out[p.catch] = String(e["*"] ?? "")
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
  }
  return out;
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
export function registerApiRoutes(app: any): void {
  for (const route of apiTable) {
    const path = partsToPath(route.parts);
    const handler = async (c: any) => {
      const mod = await route.load();
      const fn = mod[c.request.method] || (c.request.method === "GET" ? mod.default : null);
      if (!fn) return new Response("Method Not Allowed", { status: 405 });
      const url = new URL(c.request.url);
      const ctx = { params: paramsFrom(route.parts, c.params || {}), query: Object.fromEntries(url.searchParams), url };
      return toResponse(await fn(c.request, ctx));
    };
    for (const m of METHODS) app[m](path, handler);
  }
}
