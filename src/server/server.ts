import { Elysia } from "elysia";
import { parseHTML } from "linkedom";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
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
} from "../index.ts";

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

let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn) as Promise<T>;
  queue = result.catch(() => {});
  return result;
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

type CacheEntry = { html: string; status: number; buf?: Buffer; br?: Buffer; gzip?: Buffer };
const cachePage = (key: string, html: string, status: number): void => {
  pageCache.set(key, { html, status });
  if (pageCache.size > CACHE_MAX) pageCache.delete(pageCache.keys().next().value as string);
};

function settleCapped(tracker: Set<Promise<unknown>>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([settle(tracker), new Promise<void>((r) => (timer = setTimeout(r, RENDER_TIMEOUT)))]).finally(
    () => clearTimeout(timer),
  );
}

const enc = new TextEncoder();

function renderStream(key: string, status: number): ReadableStream {
  return new ReadableStream({
    start: (controller) => withLock(() => streamRoute(key, status, controller)),
  });
}

async function streamRoute(
  key: string,
  status: number,
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> {
  const send = (s: string) => controller.enqueue(enc.encode(s));

  const cached = pageCache.get(key);
  if (cached) {
    send(cached.html);
    controller.close();
    return;
  }

  const { document, Node } = parseHTML(template);
  const url = new URL("http://localhost" + key);
  const restore = enterRenderGlobals(document as unknown as Document, Node, url);
  const tracker = trackAsync();
  try {
    await renderRouteToDocument(url.pathname);
    const slots = tagBoundaries(document as unknown as Document);

    if (!slots.length) {
      const html = "<!doctype html>\n" + document.documentElement.outerHTML;
      send(html);
      cachePage(key, html, status);
      return;
    }

    const [shell, tail] = splitAtBody(document as unknown as Document);
    send(shell + fillRuntime);
    await settleCapped(tracker);

    for (const slot of slots) {
      if (slot.hasAttribute("data-fb")) continue;
      send(fillChunk(slot.getAttribute("data-vb")!, slot.innerHTML));
    }
    send(tail);
  } finally {
    untrackAsync();
    restore();
    controller.close();
  }
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

function encodeFor(accept: string, raw: Buffer, store: { br?: Buffer; gzip?: Buffer }): [string | null, Buffer] {
  if (/\bbr\b/.test(accept)) return ["br", (store.br ??= zlib.brotliCompressSync(raw))];
  if (/\bgzip\b/.test(accept)) return ["gzip", (store.gzip ??= zlib.gzipSync(raw))];
  return [null, raw];
}

type AssetEntry = { raw: Buffer; type: string; br?: Buffer; gzip?: Buffer };
const assetCache = new Map<string, AssetEntry>();
function serveAsset(rel: string, accept = ""): Response {
  const dir = path.join(DIST, "_vanilla");
  const file = path.join(dir, rel);
  if (!file.startsWith(dir) || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  let entry = assetCache.get(file);
  if (!entry)
    assetCache.set(
      file,
      (entry = { raw: fs.readFileSync(file), type: TYPES[path.extname(file)] || "application/octet-stream" }),
    );
  const [encoding, body] = encodeFor(accept, entry.raw, entry);
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

app.get("/_vanilla/*", ({ params, request }: any) =>
  serveAsset(params["*"], request.headers.get("accept-encoding") || ""),
);

app.post("/_action", async ({ body, set }: any) => {
  const { id, args } = typeof body === "string" ? JSON.parse(body) : body || {};
  if (!hasAction(id)) {
    set.status = 404;
    return { error: "unknown action" };
  }
  try {
    return await runAction(id, args);
  } catch (e: any) {
    set.status = 500;
    return { error: String(e?.message ?? e) };
  }
});

const CACHE_MAX = 5000;
const HTML_HEADERS: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
const pageCache = new Map<string, CacheEntry>();

app.get("*", ({ request }: any) => {
  const url = new URL(request.url);
  if (path.extname(url.pathname)) return new Response("Not found", { status: 404 });
  const key = url.pathname + url.search;

  const hit = pageCache.get(key);
  if (hit) {
    pageCache.delete(key);
    pageCache.set(key, hit);
    const [encoding, body] = encodeFor(
      request.headers.get("accept-encoding") || "",
      (hit.buf ??= Buffer.from(hit.html)),
      hit,
    );
    const headers: Record<string, string> = { ...HTML_HEADERS, vary: "Accept-Encoding" };
    if (encoding) headers["content-encoding"] = encoding;
    return new Response(body as unknown as BodyInit, { status: hit.status, headers });
  }
  const status = matchRoute(url.pathname) ? 200 : 404;
  return new Response(renderStream(key, status), { status, headers: HTML_HEADERS });
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

console.log(
  brand("start", `http://localhost:${PORT}`).replace(/\n$/, "") +
    c.dim(`  (ant ${(globalThis as any).Ant?.version ?? "?"})`),
);
export default { fetch, port: PORT };
