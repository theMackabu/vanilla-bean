import type { Ctx } from "./ctx.ts";

type ActionFn = (...args: unknown[]) => unknown;

const registry = new Map<string, ActionFn>();

export function __register(id: string, fn: ActionFn): ActionFn {
  registry.set(id, fn);
  (fn as any).__actionId = id;
  return fn;
}

export function hasAction(id: string): boolean {
  return registry.has(id);
}

export async function runAction(ctx: Ctx, id: string, args?: unknown[]): Promise<unknown> {
  const fn = registry.get(id);
  if (!fn) throw new Error("unknown action: " + id);
  return fn(ctx, ...(args || []));
}

export function __action(id: string): (...args: unknown[]) => Promise<unknown> {
  const proxy = async (...args: unknown[]): Promise<unknown> => {
    const res = await fetch("/_vanilla/actions/" + encodeURIComponent(id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args }),
    });

    if (!res.ok) throw new Error(`action ${id} failed (${res.status})`);
    const data = res.status === 204 ? undefined : await res.json();

    if (data && typeof data === "object" && typeof (data as any).__redirect === "string") {
      const { navigate } = await import("./router.ts");
      navigate(data.__redirect);
      return undefined;
    }

    return data;
  };
  (proxy as any).__actionId = id;
  return proxy;
}

export async function __formAction(_ctx: Ctx, url: string, e: any): Promise<void> {
  e.preventDefault();
  const form = e.currentTarget || e.target;
  const res = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json" },
    body: new URLSearchParams(new FormData(form) as any),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (data && typeof data === "object" && typeof data.__redirect === "string") {
    const { navigate } = await import("./router.ts");
    navigate(data.__redirect);
  }
  if (res.ok) form.reset?.();
}
