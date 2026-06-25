import type { Ctx } from "./ctx.ts";

type ActionFn = (...args: unknown[]) => unknown;

const registry = new Map<string, ActionFn>();

export function __register(id: string, fn: ActionFn): ActionFn {
  registry.set(id, fn);
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
  return async (...args: unknown[]): Promise<unknown> => {
    const res = await fetch("/_vanilla/actions/" + encodeURIComponent(id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args }),
    });

    if (!res.ok) throw new Error(`action ${id} failed (${res.status})`);
    const data = res.status === 204 ? undefined : await res.json();

    if (data && typeof data === "object" && typeof (data as any).__redirect === "string") {
      const { navigate } = await import("./router.ts");
      // TODO: clean up type
      navigate((data as any).__redirect);
      return undefined;
    }

    return data;
  };
}
