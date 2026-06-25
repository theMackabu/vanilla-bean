import path from "node:path";
import { c } from "../../log.ts";
import { buildShell } from "./shell.ts";
import type { Ctx } from "./index.ts";

function logRequests(server: any): void {
  server.middlewares.use((req: any, res: any, next: any) => {
    const url = (req.url || "/").split("?")[0];
    const nav = (req.headers.accept || "").includes("text/html") && !/\.[a-z0-9]+$/i.test(url);
    if (!nav) return next();
    const start = Date.now();
    res.once("finish", () => {
      const code = res.statusCode;
      const tint = code >= 500 ? c.red : code >= 400 ? c.yellow : code >= 300 ? c.cyan : c.green;
      console.log(
        `  ${c.dim(new Date().toLocaleTimeString())}  ${c.cyan(req.method)} ${c.bold(url)} ` +
          `${tint(code)} ${c.gray(Date.now() - start + "ms")}`,
      );
    });
    next();
  });
}

function nodeToRequest(req: any, url: URL): Promise<Request> {
  const method = req.method || "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers))
    if (v != null) headers.set(k, Array.isArray(v) ? v.join(",") : (v as string));
  if (method === "GET" || method === "HEAD") return Promise.resolve(new Request(url.href, { method, headers }));
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (ch: Buffer) => chunks.push(ch));
    req.on("end", () =>
      resolve(new Request(url.href, { method, headers, body: Buffer.concat(chunks), duplex: "half" } as any)),
    );
  });
}

export function devPlugin(ctx: Ctx): any {
  if (ctx.ssrBuild) return false;
  let devTemplate: string | null = null;
  return {
    name: "framework:shell",
    configurePreviewServer(server: any) {
      logRequests(server);
      server.middlewares.use((req: any, _res: any, next: any) => {
        const [pathname, query = ""] = (req.url || "/").split("?");
        if (!path.extname(pathname)) {
          req.url = pathname.replace(/\/$/, "") + "/index.html" + (query ? "?" + query : "");
        }
        next();
      });
    },
    configureServer(server: any) {
      logRequests(server);
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = new URL(req.url, "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        try {
          const { handleApi } = await server.ssrLoadModule(ctx.apiRoutesPath);
          const web =
            (await handleApi(await nodeToRequest(req, url))) ??
            new Response('{"error":"not found"}', {
              status: 404,
              headers: { "content-type": "application/json" },
            });
          res.statusCode = web.status;
          web.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(Buffer.from(await web.arrayBuffer()));
        } catch (e) {
          next(e);
        }
      });
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.method !== "GET") return next();
        if (!(req.headers.accept || "").includes("text/html")) return next();
        const url = (req.url || "/").split("?")[0];
        if (/\.[a-zA-Z0-9]+$/.test(url)) return next();
        try {
          const { renderRouteToHTML, resolveStatics } = await import("../ssr.ts");
          const fw = await server.ssrLoadModule("vanilla-bean");
          if (devTemplate === null)
            devTemplate = await resolveStatics(fw, buildShell(ctx.meta, { entry: ctx.devEntry }));
          const html = await renderRouteToHTML(fw, devTemplate, url, { keepBody: false });
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html");
          res.end(await server.transformIndexHtml(url, html));
        } catch (e) {
          next(e);
        }
      });
    },
    generateBundle(_: any, bundle: any) {
      const entry = Object.values(bundle).find((cc: any) => cc.type === "chunk" && cc.isEntry) as any;
      const cssHrefs = Object.values(bundle)
        .filter((a: any) => a.type === "asset" && a.fileName.endsWith(".css"))
        .map((a: any) => "/" + a.fileName);
      const shellHtml = buildShell(ctx.meta, { entry: entry ? "/" + entry.fileName : ctx.devEntry, cssHrefs });
      (this as any).emitFile({ type: "asset", fileName: "index.html", source: shellHtml });
    },
  };
}
