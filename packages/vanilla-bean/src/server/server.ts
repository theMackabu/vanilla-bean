import { Elysia } from "elysia";
import { parseHTML } from "linkedom";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { brand, c } from "../log.ts";
import { handleApi, matchWs, preloadWs } from "./api-routes.ts";
import { fillRuntime, fillChunk, tagBoundaries } from "./streaming.ts";

import {
  preloadAll,
  collectStatics,
  renderRouteToDocument,
  matchRoute,
  hasAction,
  runAction,
  trackAsync,
  settle,
  untrackAsync,
  enterRequest,
  exitRequest,
  getResponseHeaders,
  getRedirect,
  isRedirect,
} from "vanilla-bean";

const RENDER_TIMEOUT = Number(process.env.RENDER_TIMEOUT) || 5000;

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST || path.resolve(here, "dist");
const PORT = Number(process.env.PORT) || 9454;

const shellFile = path.join(here, "server", "shell.html");
const shell = fs.readFileSync(fs.existsSync(shellFile) ? shellFile : path.join(DIST, "index.html"), "utf8");

await preloadAll();
await preloadWs();
const template = injectStatics(shell, await collectStatics());

function injectStatics(html: string, data: Record<string, unknown>): string {
  if (!data || !Object.keys(data).length) return html;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return html.replace("</body>", `<script type="application/json" id="_vanilla_static">${json}</script></body>`);
}

let lockTail: Promise<void> = Promise.resolve();
function acquire(): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const prev = lockTail;
  lockTail = held;
  return prev.then(() => release);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

function withResHeaders(base: Record<string, string>, res: Headers | null): Headers {
  const h = new Headers(base);
  if (res) {
    for (const cookie of res.getSetCookie?.() ?? []) h.append("set-cookie", cookie);
    for (const [k, v] of res) if (k !== "set-cookie") h.set(k, v);
  }
  return h;
}

function enterRenderGlobals(document: Document, Node: unknown, url: URL): () => void {
  const saved: Record<string, unknown> = {};
  const g = globalThis as any;
  const swap = (k: string, v: unknown) => ((saved[k] = g[k]), (g[k] = v));
  swap("document", document);
  swap("Node", Node);
  swap("location", url);
  swap("history", { pushState() {}, replaceState() {} });
  swap("setInterval", () => 0);
  swap("requestAnimationFrame", () => 0);
  return () => {
    for (const k in saved) saved[k] === undefined ? delete g[k] : (g[k] = saved[k]);
  };
}

function splitAtBody(document: Document): [string, string] {
  document.body.appendChild(document.createComment("vb-stream"));
  const html = "<!doctype html>\n" + document.documentElement.outerHTML;
  const i = html.indexOf("<!--vb-stream-->");
  return [html.slice(0, i), html.slice(i + "<!--vb-stream-->".length)];
}

type EncodedStore = { br?: Buffer | Promise<Buffer>; gzip?: Buffer | Promise<Buffer> };
type CacheEntry = EncodedStore & { html: string; status: number; buf?: Buffer };
const cachePage = (key: string, html: string, status: number): void => {
  pageCache.set(key, { html, status });
  if (pageCache.size > CACHE_MAX) pageCache.delete(pageCache.keys().next().value as string);
};

function settleCapped(tracker: Set<Promise<unknown>>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    settle(tracker).then(() => tracker.size === 0),
    new Promise<false>((r) => (timer = setTimeout(() => r(false), RENDER_TIMEOUT))),
  ]).finally(() => clearTimeout(timer));
}

const enc = new TextEncoder();
const NAV_MIME = "application/vnd.vanilla-bean.nav+json";

type HtmlOut =
  | { kind: "redirect"; redirect: { url: string; status: number }; res: Headers | null }
  | { kind: "html"; html: string; res: Headers | null }
  | { kind: "stream"; stream: ReadableStream; res: Headers | null };

async function renderHtml(key: string, status: number, origin: string, request: Request): Promise<HtmlOut> {
  const release = await acquire();
  const { document, Node } = parseHTML(template);
  const url = new URL(key, origin);
  const restore = enterRenderGlobals(document as unknown as Document, Node, url);
  enterRequest(request);
  const tracker = trackAsync();
  let handed = false;
  const finish = (): void => {
    untrackAsync();
    exitRequest();
    restore();
    release();
  };

  try {
    let rendered: { cache: boolean } | undefined;
    try {
      rendered = await renderRouteToDocument(url.pathname);
    } catch (e) {
      if (!isRedirect(e)) throw e;
    }
    const res = getResponseHeaders();

    const redirect = getRedirect();
    if (redirect) {
      finish();
      return { kind: "redirect", redirect, res };
    }

    const slots = tagBoundaries(document as unknown as Document);
    if (!slots.length) {
      const html = "<!doctype html>\n" + document.documentElement.outerHTML;
      if (rendered?.cache) cachePage(key, html, status);
      finish();
      return { kind: "html", html, res };
    }

    handed = true;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (s: string) => controller.enqueue(enc.encode(s));
        try {
          const [shell, tail] = splitAtBody(document as unknown as Document);
          send(shell + fillRuntime);
          await settleCapped(tracker);
          const late = getRedirect();
          if (late) {
            send(`<script>location.replace(${JSON.stringify(late.url)})</script>`);
          } else {
            for (const slot of slots) {
              if (slot.hasAttribute("data-fb")) continue;
              send(fillChunk(slot.getAttribute("data-vb")!, slot.innerHTML));
            }
          }
          send(tail);
        } finally {
          finish();
          controller.close();
        }
      },
    });
    return { kind: "stream", stream, res };
  } catch (e) {
    if (!handed) finish();
    throw e;
  }
}

type NavOut = { status: number; body: Record<string, unknown>; res: Headers | null };

function renderNav(key: string, origin: string, request: Request): Promise<NavOut> {
  return withLock(async () => {
    const { document, Node } = parseHTML(template);
    const url = new URL(key, origin);
    const restore = enterRenderGlobals(document as unknown as Document, Node, url);
    enterRequest(request);
    const tracker = trackAsync();
    try {
      try {
        await renderRouteToDocument(url.pathname);
      } catch (e) {
        if (!isRedirect(e)) throw e;
      }
      let redirect = getRedirect();
      if (!redirect) {
        await settleCapped(tracker);
        redirect = getRedirect();
      }
      const res = getResponseHeaders();
      if (redirect) return { status: 200, body: { redirect: redirect.url }, res };
      const islands: Record<string, string> = {};
      for (const el of (document as unknown as Document).querySelectorAll('island[data-mode="server"][data-key]')) {
        islands[el.getAttribute("data-key")!] = el.innerHTML;
      }
      return { status: matchRoute(url.pathname) ? 200 : 404, body: { islands }, res };
    } finally {
      untrackAsync();
      exitRequest();
      restore();
    }
  });
}

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

const brotliCompress = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const HTML_BROTLI_OPTIONS = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } };

async function cachedCompression(
  store: EncodedStore,
  key: "br" | "gzip",
  compress: () => Promise<Buffer>,
): Promise<Buffer> {
  const cached = store[key];
  if (cached) return cached;
  const pending = compress();
  store[key] = pending;
  try {
    const body = await pending;
    store[key] = body;
    return body;
  } catch (err) {
    delete store[key];
    throw err;
  }
}

async function encodeFor(
  accept: string,
  raw: Buffer,
  store: EncodedStore,
  options?: { html?: boolean },
): Promise<[string | null, Buffer]> {
  if (/\bbr\b/.test(accept)) {
    return [
      "br",
      await cachedCompression(store, "br", () => brotliCompress(raw, options?.html ? HTML_BROTLI_OPTIONS : undefined)),
    ];
  }
  if (/\bgzip\b/.test(accept)) {
    return ["gzip", await cachedCompression(store, "gzip", () => gzip(raw))];
  }
  return [null, raw];
}

type AssetEntry = EncodedStore & { raw: Buffer; type: string };
const assetCache = new Map<string, AssetEntry>();
async function serveAsset(rel: string, accept = ""): Promise<Response> {
  const dir = path.join(DIST, "_vanilla");
  const file = path.join(dir, rel);
  if (!file.startsWith(dir) || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  let entry = assetCache.get(file);
  if (!entry)
    assetCache.set(
      file,
      (entry = { raw: fs.readFileSync(file), type: TYPES[path.extname(file)] || "application/octet-stream" }),
    );
  const [encoding, body] = await encodeFor(accept, entry.raw, entry);
  const headers: Record<string, string> = {
    "content-type": entry.type,
    "cache-control": "public, max-age=31536000, immutable",
    vary: "Accept-Encoding",
  };
  if (encoding) headers["content-encoding"] = encoding;
  return new Response(body as unknown as BodyInit, { headers });
}

const app = new Elysia();

app.onRequest(async ({ request }: any) => {
  if (!new URL(request.url).pathname.startsWith("/api/")) return;
  return (
    (await handleApi(request)) ??
    new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
  );
});

app.get("/_vanilla/*", async ({ params, request }: any) =>
  serveAsset(params["*"], request.headers.get("accept-encoding") || ""),
);

const JSON_HEADERS = { "content-type": "application/json" };

app.post("/_vanilla/actions/:id", async ({ params, body, set, request }: any) => {
  const id = params.id;
  const { args } = typeof body === "string" ? JSON.parse(body) : body || {};
  if (!hasAction(id)) {
    set.status = 404;
    return { error: "unknown action" };
  }
  return withLock(async () => {
    enterRequest(request);
    try {
      const result = await runAction(id, args);
      return new Response(JSON.stringify(result ?? null), {
        headers: withResHeaders(JSON_HEADERS, getResponseHeaders()),
      });
    } catch (e: any) {
      if (isRedirect(e)) {
        return new Response(JSON.stringify({ __redirect: e.redirect.url }), {
          headers: withResHeaders(JSON_HEADERS, getResponseHeaders()),
        });
      }
      return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: JSON_HEADERS });
    } finally {
      exitRequest();
    }
  });
});

const CACHE_MAX = 5000;
const HTML_HEADERS: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
const pageCache = new Map<string, CacheEntry>();

app.get("*", async ({ request }: any) => {
  const url = new URL(request.url);
  if (path.extname(url.pathname)) return new Response("Not found", { status: 404 });
  const key = url.pathname + url.search;

  if ((request.headers.get("accept") || "").includes(NAV_MIME)) {
    const { status, body, res } = await renderNav(key, url.origin, request);
    return new Response(JSON.stringify({ status, ...body }), {
      status,
      headers: withResHeaders({ "content-type": NAV_MIME }, res),
    });
  }

  const hit = pageCache.get(key);
  if (hit) {
    pageCache.delete(key);
    pageCache.set(key, hit);
    const [encoding, body] = await encodeFor(
      request.headers.get("accept-encoding") || "",
      (hit.buf ??= Buffer.from(hit.html)),
      hit,
      { html: true },
    );
    const headers: Record<string, string> = { ...HTML_HEADERS, vary: "Accept-Encoding" };
    if (encoding) headers["content-encoding"] = encoding;
    return new Response(body as unknown as BodyInit, { status: hit.status, headers });
  }
  const status = matchRoute(url.pathname) ? 200 : 404;
  const out = await renderHtml(key, status, url.origin, request);
  const headers = withResHeaders(HTML_HEADERS, out.res);
  if (out.kind === "redirect") {
    headers.set("location", out.redirect.url);
    return new Response(null, { status: out.redirect.status, headers });
  }
  if (out.kind === "html") return new Response(out.html, { status, headers });
  return new Response(out.stream, { status, headers });
});

function fetch(request: Request, env: any): Response | Promise<Response> {
  if ((request.headers.get("upgrade") || "").toLowerCase() === "websocket") {
    const url = new URL(request.url);
    const match = matchWs(url.pathname);
    if (match && env && typeof env.upgradeWebSocket === "function") {
      const { socket, response } = env.upgradeWebSocket(request);
      const ctx = { params: match.params, query: Object.fromEntries(url.searchParams), url, request };
      const mod = match.module;
      socket.addEventListener("open", () => mod.open?.(socket, ctx));
      socket.addEventListener("message", (e: MessageEvent) => mod.message?.(socket, e.data, ctx));
      socket.addEventListener("close", () => mod.close?.(socket, ctx));
      socket.addEventListener("error", (e: Event) => mod.error?.(socket, ctx, e));
      return response;
    }
    return new Response("no socket route", { status: 404 });
  }
  return app.fetch(request);
}

const runtimeTag = (() => {
  const g = globalThis as any;
  if (g.Ant?.version) return `ant ${g.Ant.version}`;
  if (g.Bun?.version) return `bun ${g.Bun.version}`;
  if (g.Deno?.version?.deno) return `deno ${g.Deno.version.deno}`;
  return `node ${process.versions.node}`;
})();

console.log(brand("start", `http://localhost:${PORT}`).replace(/\n$/, "") + c.dim(`  (${runtimeTag})`));
export default { fetch, port: PORT };
