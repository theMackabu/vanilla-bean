type ActionFn = (...args: unknown[]) => unknown;

const registry = new Map<string, ActionFn>();

export function __register(id: string, fn: ActionFn): ActionFn {
  registry.set(id, fn);
  return fn;
}

export function hasAction(id: string): boolean {
  return registry.has(id);
}

export async function runAction(id: string, args?: unknown[]): Promise<unknown> {
  const fn = registry.get(id);
  if (!fn) throw new Error("unknown action: " + id);
  return fn(...(args || []));
}

export function __action(id: string): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]): Promise<unknown> => {
    const res = await fetch("/_action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, args }),
    });
    if (!res.ok) throw new Error(`action ${id} failed (${res.status})`);
    return res.status === 204 ? undefined : res.json();
  };
}
