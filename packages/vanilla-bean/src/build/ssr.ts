import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { parseHTML } from "linkedom";
import { c } from "../log.ts";
import { apiRouteMeta, uniqueRoutes, type RouteMeta } from "../server/route-paths.ts";

export function injectStatics(html: string, statics: Record<string, unknown>): string {
  if (!statics || !Object.keys(statics).length) return html;
  const json = JSON.stringify(statics).replace(/</g, "\\u003c");
  return html.replace("</body>", `<script type="application/json" id="_vanilla_static">${json}</script></body>`);
}

export async function renderRouteToHTML(
  fw: any,
  template: string,
  route: string,
  {
    keepBody = true,
    origin = "http://localhost",
    request,
  }: { keepBody?: boolean; origin?: string; request?: Request } = {},
): Promise<string> {
  const { document, Node } = parseHTML(template);
  const url = new URL(route, origin);
  const ctx = fw.makeCtx(document, Node, { url, request: request ?? new Request(url) });
  await fw.renderRouteToDocument(ctx, route);
  if (!keepBody) document.getElementById("root")?.replaceChildren();
  return "<!doctype html>\n" + document.documentElement.outerHTML;
}

export async function resolveStatics(fw: any, template: string): Promise<string> {
  await fw.preloadAll();
  const statics = await fw.collectStatics();
  return injectStatics(template, statics);
}

type EndpointRoute = RouteMeta & { kind: "api" | "ws"; methods?: string[] };
type ServerAction = { file: string; name: string };

const SOURCE_EXT = /\.[jt]sx?$/;
const WS_EXT = /\.ws\.[jt]sx?$/;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

function walkFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function source(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function exportedMethods(file: string): string[] {
  const code = source(file);
  const methods = METHODS.filter((method) =>
    new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${method}\\b|\\bexport\\s+(?:const|let|var)\\s+${method}\\b`).test(
      code,
    ),
  );
  if (!methods.length && /\bexport\s+default\b/.test(code)) methods.push("GET");
  return methods.length ? methods : ["*"];
}

function scanEndpointRoutes(root: string): EndpointRoute[] {
  const files = walkFiles(path.join(root, "src", "api")).filter((file) => SOURCE_EXT.test(file));
  const api = uniqueRoutes(
    files
      .filter((file) => !WS_EXT.test(file))
      .map((file) => ({ kind: "api" as const, methods: exportedMethods(file), ...apiRouteMeta(file, SOURCE_EXT) })),
  );
  const ws = uniqueRoutes(
    files.filter((file) => WS_EXT.test(file)).map((file) => ({ kind: "ws" as const, ...apiRouteMeta(file, WS_EXT) })),
  );
  return [...api, ...ws].sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}

function hasUseServerDirective(code: string): boolean {
  return /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*["']use server["'];?/.test(code);
}

function scanServerActions(root: string): ServerAction[] {
  const files = walkFiles(path.join(root, "src")).filter((file) => SOURCE_EXT.test(file));
  const actions: ServerAction[] = [];

  for (const file of files) {
    const code = source(file);
    if (!hasUseServerDirective(code)) continue;

    for (const match of code.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g)) {
      actions.push({ file, name: match[1]! });
    }
    for (const match of code.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g)) {
      actions.push({ file, name: match[1]! });
    }
  }

  return actions.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
}

function logEndpoints(root: string): void {
  const endpoints = scanEndpointRoutes(root);
  const actions = scanServerActions(root);
  if (!endpoints.length && !actions.length) return;

  console.log();

  const kindPad = Math.max("action".length, ...endpoints.map((route) => route.kind.length));
  const namePad = Math.max(
    0,
    ...actions.map((action) => action.name.length),
    ...endpoints.map((route) => (route.kind === "ws" ? "socket" : (route.methods || ["*"]).join(",")).length),
  );
  const pathPad = Math.max(0, ...endpoints.map((route) => route.path.length));

  for (const action of actions) {
    console.log(
      `  ${c.green("✓")} ${c.magenta("action".padEnd(kindPad))} ${c.bold(action.name.padEnd(namePad))}  ` +
        `${c.dim(rel(root, action.file))}`,
    );
  }
  if (actions.length && endpoints.length) console.log();

  for (const route of endpoints) {
    const name = route.kind === "ws" ? "socket" : (route.methods || ["*"]).join(",");
    console.log(
      `  ${c.green("✓")} ${c.magenta(route.kind.padEnd(kindPad))} ${c.bold(name.padEnd(namePad))}  ` +
        `${c.bold(route.path.padEnd(pathPad))}  ${c.dim(rel(root, route.file))}`,
    );
  }
}

export async function prerender({
  root,
  outDir = "dist",
  template,
  plugins,
}: {
  root: string;
  outDir?: string;
  template?: string;
  plugins?: any[];
}): Promise<void> {
  const distDir = path.resolve(root, outDir);
  template = template || fs.readFileSync(path.join(distDir, "index.html"), "utf8");

  console.log();

  const server = await createServer({
    root,
    configFile: false,
    plugins,
    appType: "custom",
    server: { middlewareMode: true },
    logLevel: "silent",
  });

  const started = Date.now();
  const rows: string[] = [];
  try {
    const fw: any = await server.ssrLoadModule("vanilla-bean");
    fw.installTimerGuard?.("warn");
    const tmpl = await resolveStatics(fw, template);
    const routes = Object.keys(fw.routes).sort();
    const relOf = (r: string) => (r === "/" ? "index.html" : path.join(r.replace(/^\//, ""), "index.html"));
    const routePad = Math.max(...routes.map((r) => r.length));
    const pathPad = Math.max(...routes.map((r) => relOf(r).length));
    for (const route of routes) {
      const t = Date.now();
      const mod = await fw.routes[route]?.().catch(() => null);
      if (mod && mod.cache === false) {
        console.log(
          `  ${c.yellow("○")} ${c.dim("ssg")} ${c.bold(route.padEnd(routePad))}  ${c.gray("→ dynamic, skipped")}`,
        );
        continue;
      }
      let html: string;
      try {
        html = await renderRouteToHTML(fw, tmpl, route);
      } catch (e) {
        if (fw.isRedirect?.(e)) {
          console.log(
            `  ${c.yellow("○")} ${c.dim("ssg")} ${c.bold(route.padEnd(routePad))}  ${c.gray("→ redirect, skipped")}`,
          );
          continue;
        }
        throw e;
      }
      const outRoute = route === "/" ? distDir : path.join(distDir, route);
      fs.mkdirSync(outRoute, { recursive: true });
      fs.writeFileSync(path.join(outRoute, "index.html"), html);
      const kb = (Buffer.byteLength(html) / 1024).toFixed(1) + " kB";
      const ms = Date.now() - t + "ms";
      console.log(
        `  ${c.green("✓")} ${c.cyan("ssg")} ${c.bold(route.padEnd(routePad))}  ` +
          `${c.gray("→")} ${c.dim(relOf(route).padEnd(pathPad))}  ` +
          `${c.yellow(kb.padStart(8))} ${c.gray("│")} ${c.gray(ms.padStart(5))}`,
      );
      rows.push(route);
    }

    const t404 = Date.now();
    const html404 = await renderRouteToHTML(fw, tmpl, "/404");
    fs.writeFileSync(path.join(distDir, "404.html"), html404);
    console.log(
      `  ${c.green("✓")} ${c.cyan("ssg")} ${c.bold("(not found)".padEnd(routePad))}  ` +
        `${c.gray("→")} ${c.dim("404.html".padEnd(pathPad))}  ` +
        `${c.yellow(((Buffer.byteLength(html404) / 1024).toFixed(1) + " kB").padStart(8))} ` +
        `${c.gray("│")} ${c.gray((Date.now() - t404 + "ms").padStart(5))}`,
    );

    console.log(
      `\n  ${c.green(c.bold("✓"))} ${c.green(`prerendered ${rows.length} route${rows.length === 1 ? "" : "s"}`)} ` +
        `${c.dim("in " + (Date.now() - started) + "ms")}`,
    );

    logEndpoints(root);
  } finally {
    await server.close();
  }
}
