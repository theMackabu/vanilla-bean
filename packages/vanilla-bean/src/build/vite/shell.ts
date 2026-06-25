const VOID = new Set(["meta", "link", "input", "br", "hr", "img", "source"]);

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

function el(tag: string, attrs: Record<string, unknown> = {}, children: unknown = []): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");
  if (VOID.has(tag)) return `<${tag}${a}>`;
  const inner = ([] as unknown[])
    .concat(children as any)
    .filter((ch) => ch != null && ch !== false)
    .join("");
  return `<${tag}${a}>${inner}</${tag}>`;
}

export function buildShell(meta: any, { entry, cssHrefs = [] }: { entry: string; cssHrefs?: string[] }): string {
  const head = el("head", {}, [
    el("meta", { charset: "utf-8" }),
    el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    el("title", {}, esc(meta.title)),
    meta.description && el("meta", { name: "description", content: meta.description }),
    ...cssHrefs.map((href) => el("link", { rel: "stylesheet", href })),
  ]);
  const body = el("body", {}, [el("div", { id: "root" }), el("script", { type: "module", src: entry })]);
  return "<!doctype html>\n" + el("html", { lang: meta.lang }, [head, body]);
}
