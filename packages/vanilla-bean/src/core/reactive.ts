import type { Ctx } from "./ctx.ts";

type Effect = {
  ctx: Ctx;
  deps: Set<Set<Effect>>;
  children: Set<Effect>;
  cleanups: Array<() => void>;
  disposed: boolean;
  asyncFn?: boolean;
  schedule?(): void;
  execute(): unknown;
};

export type Owner = { children: Set<Effect>; cleanups: Array<() => void>; disposed: boolean };

export function createOwner(): Owner {
  return { children: new Set(), cleanups: [], disposed: false };
}
export function runWithOwner<T>(ctx: Ctx, owner: Owner | null, fn: () => T): T {
  const prev = ctx.owner;
  ctx.owner = owner;
  try {
    return fn();
  } finally {
    ctx.owner = prev;
  }
}
export function onCleanup(ctx: Ctx, fn: () => void): void {
  if (ctx.owner && !ctx.owner.disposed) ctx.owner.cleanups.push(fn);
}
function runCleanups(node: { cleanups: Array<() => void> }): void {
  for (let i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]!();
  node.cleanups.length = 0;
}

const pendingEffects = new Set<Effect>();
let flushQueued = false;
let flushing = false;

function scheduleEffect(eff: Effect): void {
  if (eff.disposed) return;
  pendingEffects.add(eff);
  if (flushQueued || flushing) return;
  flushQueued = true;
  queueMicrotask(flushEffects);
}

function flushEffects(): void {
  flushQueued = false;
  flushing = true;
  try {
    for (const eff of pendingEffects) {
      pendingEffects.delete(eff);
      eff.execute();
    }
  } finally {
    flushing = false;
  }
  if (pendingEffects.size) {
    flushQueued = true;
    queueMicrotask(flushEffects);
  }
}

function notifyEffect(eff: Effect): void {
  if (eff.disposed) return;
  if (eff.schedule) eff.schedule();
  else scheduleEffect(eff);
}

function currentEffect(ctx: Ctx): Effect | undefined {
  return ctx.listeners[ctx.listeners.length - 1];
}

function cleanup(eff: Effect): void {
  for (const subs of eff.deps) subs.delete(eff);
  eff.deps.clear();
}

export type Signal<T> = {
  (): T;
  (next: T): void;
};

export function makeSignal<T>(ctx: Ctx, initial?: T): Signal<T> {
  let value = initial as T;
  const subscribers = new Set<Effect>();

  const read = (): T => {
    const eff = currentEffect(ctx);
    if (eff) {
      subscribers.add(eff);
      eff.deps.add(subscribers);
    }
    return value;
  };

  const write = (next: T): void => {
    if (Object.is(next, value)) return;
    value = next;
    const active = currentEffect(ctx);
    for (const eff of subscribers) {
      if (eff !== active) notifyEffect(eff);
    }
  };

  const fn = (...args: [] | [T]): T | void => (args.length === 0 ? read() : write(args[0] as T));
  return fn as Signal<T>;
}

export function signal<T>(ctx: Ctx, initial: T): Signal<T>;
export function signal<T = undefined>(ctx: Ctx): Signal<T | undefined>;
export function signal(ctx: Ctx, initial?: any): any {
  return makeSignal(ctx, initial);
}

export type Boundary = {
  pending?: Signal<number>;
  fail?: (err: unknown) => void;
};

export function withBoundary<T>(ctx: Ctx, b: Boundary, fn: () => T): T {
  const prev = ctx.boundary;
  ctx.boundary = b;
  try {
    return fn();
  } finally {
    ctx.boundary = prev;
  }
}

export function trackAsync(ctx: Ctx): Set<Promise<unknown>> {
  return (ctx.tracker = new Set());
}
export function untrackAsync(ctx: Ctx): void {
  ctx.tracker = null;
}
export function trackServer(ctx: Ctx, p: Promise<unknown>): void {
  ctx.tracker?.add(p);
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

export function effect(ctx: Ctx, fn: () => unknown): Effect {
  const parent = ctx.owner;
  const eff: Effect = {
    ctx,
    deps: new Set(),
    children: new Set(),
    cleanups: [],
    disposed: false,
    asyncFn: isAsyncFn(fn),
    execute() {
      if (eff.disposed) return;
      if (import.meta.env?.SSR && eff.asyncFn) {
        if (ctx.boundary && ctx.boundary.pending) ctx.boundary.pending(ctx.boundary.pending() + 1);
        return;
      }
      runCleanups(eff);
      cleanup(eff);
      ctx.listeners.push(eff);
      const prevOwner = ctx.owner;
      ctx.owner = eff;
      const b = ctx.boundary;
      let result: unknown;
      try {
        result = fn();
      } finally {
        ctx.listeners.pop();
        ctx.owner = prevOwner;
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

export function dispose(node: Owner | Effect | null | undefined): void {
  if (!node || node.disposed) return;
  node.disposed = true;
  pendingEffects.delete(node as Effect);
  runCleanups(node);
  for (const child of node.children) dispose(child);
  node.children.clear();
  if ((node as Effect).deps) cleanup(node as Effect);
}

export function disposeChildren(eff: Effect | null | undefined): void {
  if (!eff) return;
  for (const child of eff.children) dispose(child);
  eff.children.clear();
}

export function derived<T>(ctx: Ctx, fn: () => T): () => T {
  let value: T;
  let dirty = true;
  const subscribers = new Set<Effect>();
  const parent = ctx.owner;
  const computed: Effect = {
    ctx,
    deps: new Set(),
    children: new Set(),
    cleanups: [],
    disposed: false,
    schedule() {
      if (computed.disposed || dirty) return;
      dirty = true;
      const active = currentEffect(ctx);
      for (const eff of subscribers) {
        if (eff !== active) notifyEffect(eff);
      }
    },
    execute() {
      computed.schedule?.();
    },
  };

  if (parent) parent.children.add(computed);

  const recompute = (): T => {
    runCleanups(computed);
    cleanup(computed);
    ctx.listeners.push(computed);
    const prevOwner = ctx.owner;
    ctx.owner = computed;
    try {
      value = fn();
      dirty = false;
      return value;
    } finally {
      ctx.listeners.pop();
      ctx.owner = prevOwner;
    }
  };

  return () => {
    const eff = currentEffect(ctx);
    if (eff) {
      subscribers.add(eff);
      eff.deps.add(subscribers);
    }
    return dirty ? recompute() : value;
  };
}

export type { Effect };
