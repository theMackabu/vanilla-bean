export type Part = string | { param: string } | { catch: string };

export type RouteMeta = {
  file: string;
  path: string;
  parts: Part[];
};

function normalizeFile(file: string): string {
  return file.split("\\").join("/");
}

export function routePartsOfApiFile(file: string, strip: RegExp): Part[] {
  const normalized = normalizeFile(file);
  const srcApi = normalized.lastIndexOf("/src/api/");
  const rel =
    srcApi >= 0
      ? normalized.slice(srcApi + "/src".length)
      : normalized.startsWith("/src/api/")
        ? normalized.replace(/^\/src/, "")
        : normalized;

  return rel
    .replace(strip, "")
    .replace(/\/index$/, "")
    .split("/")
    .filter(Boolean)
    .map((seg): Part => {
      let m: RegExpMatchArray | null;
      if ((m = seg.match(/^\[\.\.\.(.+)\]$/))) return { catch: m[1]! };
      if ((m = seg.match(/^\[(.+)\]$/))) return { param: m[1]! };
      return seg;
    });
}

export function partsToPath(parts: Part[]): string {
  return "/" + parts.map((p) => (typeof p === "string" ? p : "param" in p ? ":" + p.param : "*")).join("/");
}

export function apiRouteMeta(file: string, strip: RegExp): RouteMeta {
  const parts = routePartsOfApiFile(file, strip);
  return { file, path: partsToPath(parts), parts };
}

export const byStatic = (a: RouteMeta, b: RouteMeta): number =>
  b.parts.filter((p) => typeof p === "string").length - a.parts.filter((p) => typeof p === "string").length ||
  a.parts.length - b.parts.length ||
  a.path.localeCompare(b.path);

function isIndexRoute(file: string): boolean {
  return /\/index(?:\.ws)?\.[jt]sx?$/.test(normalizeFile(file));
}

export function uniqueRoutes<T extends RouteMeta>(routes: T[]): T[] {
  const byPath = new Map<string, T>();
  for (const route of routes) {
    const prev = byPath.get(route.path);
    if (!prev || (isIndexRoute(route.file) && !isIndexRoute(prev.file))) byPath.set(route.path, route);
  }
  return [...byPath.values()].sort(byStatic);
}
