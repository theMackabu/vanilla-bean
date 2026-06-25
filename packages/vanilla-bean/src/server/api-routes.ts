type Loader = () => Promise<any>;
type Part = string | { param: string } | { catch: string };
type Route = { load: Loader; parts: Part[]; module?: any };

const apiModules = import.meta.glob("/src/api/**/*.{js,jsx,ts,tsx}");
const wsModules = import.meta.glob("/src/api/**/*.ws.{js,jsx,ts,tsx}");

function patternOf(file: string, strip: RegExp): Part[] {
  const rel = file
    .replace(/^\/src/, "")
    .replace(strip, "")
    .replace(/\/index$/, "");

  return rel
    .split("/")
    .filter(Boolean)
    .map((seg): Part => {
      let m: RegExpMatchArray | null;
      if ((m = seg.match(/^\[\.\.\.(.+)\]$/))) return { catch: m[1]! };
      if ((m = seg.match(/^\[(.+)\]$/))) return { param: m[1]! };
      return seg;
    });
}

const byStatic = (a: Route, b: Route): number =>
  b.parts.filter((p) => typeof p === "string").length - a.parts.filter((p) => typeof p === "string").length;

const apiTable: Route[] = Object.entries(apiModules)
  .filter(([file]) => !/\.ws\.[jt]sx?$/.test(file))
  .map(([file, load]) => ({ load, parts: patternOf(file, /\.[jt]sx?$/) }))
  .sort(byStatic);

const wsTable: Route[] = Object.entries(wsModules)
  .map(([file, load]) => ({ load, module: null, parts: patternOf(file, /\.ws\.[jt]sx?$/) }))
  .sort(byStatic);

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
