type Effect = {
  deps: Set<Set<Effect>>;
  children: Set<Effect>;
  disposed: boolean;
  execute(): unknown;
};

const effectStack: Effect[] = [];

function currentEffect(): Effect | undefined {
  return effectStack[effectStack.length - 1];
}

function cleanup(eff: Effect): void {
  for (const subs of eff.deps) subs.delete(eff);
  eff.deps.clear();
}

export type Signal<T> = {
  (): T;
  (next: T): void;
};

export function makeSignal<T>(initial?: T): Signal<T> {
  let value = initial as T;
  const subscribers = new Set<Effect>();

  const read = (): T => {
    const eff = currentEffect();
    if (eff) {
      subscribers.add(eff);
      eff.deps.add(subscribers);
    }
    return value;
  };

  const write = (next: T): void => {
    if (Object.is(next, value)) return;
    value = next;
    for (const eff of [...subscribers]) {
      if (eff !== currentEffect()) eff.execute();
    }
  };

  const fn = (...args: [] | [T]): T | void => (args.length === 0 ? read() : write(args[0] as T));
  return fn as Signal<T>;
}

// The compiler rewrites a signal's reads and writes into get/set calls, so to the
// author it behaves like a plain value. Type it as that value (not Signal<T>) so the
// sugar — `count`, `count++`, `count = x` — type-checks. makeSignal is the real
// callable for code that opts out of the sugar (internals, escape hatch).
export function signal<T>(initial: T): T;
export function signal<T = undefined>(): T | undefined;
export function signal(initial?: any): any {
  return makeSignal(initial);
}

export type Boundary = {
  pending?: Signal<number>;
  fail?: (err: unknown) => void;
};

let boundary: Boundary | null = null;
export function withBoundary<T>(b: Boundary, fn: () => T): T {
  const prev = boundary;
  boundary = b;
  try {
    return fn();
  } finally {
    boundary = prev;
  }
}

let asyncTracker: Set<Promise<unknown>> | null = null;
export function trackAsync(): Set<Promise<unknown>> {
  return (asyncTracker = new Set());
}
export function untrackAsync(): void {
  asyncTracker = null;
}

export function trackServer(p: Promise<unknown>): void {
  asyncTracker?.add(p);
}

const isAsyncFn = (fn: unknown): boolean => (fn as any)?.constructor?.name === "AsyncFunction";

export async function settle(set: Set<Promise<unknown>>): Promise<boolean> {
  let did = false;
  for (let i = 0; i < 50 && set.size; i++) {
    did = true;
    const inFlight = [...set];
    set.clear();
    await Promise.allSettled(inFlight);
    await Promise.resolve();
  }
  return did;
}

export function effect(fn: () => unknown): Effect {
  const parent = currentEffect();
  const eff: Effect = {
    deps: new Set(),
    children: new Set(),
    disposed: false,
    execute() {
      if (eff.disposed) return;
      if (import.meta.env?.SSR && isAsyncFn(fn)) {
        if (boundary && boundary.pending) boundary.pending(boundary.pending() + 1);
        return;
      }
      cleanup(eff);
      effectStack.push(eff);
      const b = boundary;
      let result: unknown;
      try {
        result = fn();
      } finally {
        effectStack.pop();
      }
      if (result && typeof (result as Promise<unknown>).then === "function") {
        if (b && b.pending) b.pending(b.pending() + 1);
        Promise.resolve(result)
          .catch((err) => (b && b.fail ? b.fail(err) : console.error(err)))
          .finally(() => b && b.pending && b.pending(b.pending() - 1));
      }
      return result;
    },
  };
  if (parent) parent.children.add(eff);
  eff.execute();
  return eff;
}

export function dispose(eff: Effect | null | undefined): void {
  if (!eff || eff.disposed) return;
  eff.disposed = true;
  for (const child of eff.children) dispose(child);
  eff.children.clear();
  cleanup(eff);
}

export function disposeChildren(eff: Effect | null | undefined): void {
  if (!eff) return;
  for (const child of eff.children) dispose(child);
  eff.children.clear();
}

export function derived<T>(fn: () => T): () => T {
  const out = makeSignal<T>();
  effect(() => out(fn()));
  return () => out() as T;
}

export type { Effect };
