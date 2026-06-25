import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { parseHTML } from "linkedom";
import { c } from "../log.ts";

export function injectStatics(html: string, statics: Record<string, unknown>): string {
  if (!statics || !Object.keys(statics).length) return html;
  const json = JSON.stringify(statics).replace(/</g, "\\u003c");
  return html.replace("</body>", `<script type="application/json" id="_vanilla_static">${json}</script></body>`);
}

export async function renderRouteToHTML(
  fw: any,
  template: string,
  route: string,
  { keepBody = true }: { keepBody?: boolean } = {},
): Promise<string> {
  const saved: Record<string, unknown> = {};
  const g = globalThis as any;
  const swap = (k: string, v: unknown) => ((saved[k] = g[k]), (g[k] = v));
  const { document, Node } = parseHTML(template);
  swap("document", document);
  swap("Node", Node);
  swap("location", new URL("http://localhost" + route));
  swap("history", { pushState() {}, replaceState() {} });
  swap("fetch", () => new Promise(() => {}));
  swap("setInterval", () => 0);
  swap("requestAnimationFrame", () => 0);

  try {
    await fw.renderRouteToDocument(route);
    if (!keepBody) document.getElementById("root")?.replaceChildren();
    return "<!doctype html>\n" + document.documentElement.outerHTML;
  } finally {
    for (const k in saved) saved[k] === undefined ? delete g[k] : (g[k] = saved[k]);
  }
}

export async function resolveStatics(fw: any, template: string): Promise<string> {
  await fw.preloadAll();
  const statics = await fw.collectStatics();
  return injectStatics(template, statics);
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
    const tmpl = await resolveStatics(fw, template);
    const routes = Object.keys(fw.routes).sort();
    const relOf = (r: string) => (r === "/" ? "index.html" : path.join(r.replace(/^\//, ""), "index.html"));
    const routePad = Math.max(...routes.map((r) => r.length));
    const pathPad = Math.max(...routes.map((r) => relOf(r).length));
    for (const route of routes) {
      const t = Date.now();
      const html = await renderRouteToHTML(fw, tmpl, route);
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
  } finally {
    await server.close();
  }

  console.log(
    `\n  ${c.green(c.bold("✓"))} ${c.green(`prerendered ${rows.length} route${rows.length === 1 ? "" : "s"}`)} ` +
      `${c.dim("in " + (Date.now() - started) + "ms")}\n`,
  );
}
