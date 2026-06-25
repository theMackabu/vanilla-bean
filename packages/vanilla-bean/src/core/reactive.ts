type Effect = {
  deps: Set<Set<Effect>>;
  children: Set<Effect>;
  cleanups: Array<() => void>;
  disposed: boolean;
  asyncFn?: boolean;
  schedule?(): void;
  execute(): unknown;
};

export type Owner = { children: Set<Effect>; cleanups: Array<() => void>; disposed: boolean };
let currentOwnerNode: Owner | null = null;

export function createOwner(): Owner {
  return { children: new Set(), cleanups: [], disposed: false };
}
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = currentOwnerNode;
  currentOwnerNode = owner;
  try {
    return fn();
  } finally {
    currentOwnerNode = prev;
  }
}
export function onCleanup(fn: () => void): void {
  if (currentOwnerNode && !currentOwnerNode.disposed) currentOwnerNode.cleanups.push(fn);
}
function runCleanups(node: { cleanups: Array<() => void> }): void {
  for (let i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]!();
  node.cleanups.length = 0;
}

const effectStack: Effect[] = [];
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
    const active = currentEffect();
    for (const eff of subscribers) {
      if (eff !== active) notifyEffect(eff);
    }
  };

  const fn = (...args: [] | [T]): T | void => (args.length === 0 ? read() : write(args[0] as T));
  return fn as Signal<T>;
}

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
  const parent = currentOwnerNode;
  const eff: Effect = {
    deps: new Set(),
    children: new Set(),
    cleanups: [],
    disposed: false,
    asyncFn: isAsyncFn(fn),
    execute() {
      if (eff.disposed) return;
      if (import.meta.env?.SSR && eff.asyncFn) {
        if (boundary && boundary.pending) boundary.pending(boundary.pending() + 1);
        return;
      }
      runCleanups(eff);
      cleanup(eff);
      effectStack.push(eff);
      const prevOwner = currentOwnerNode;
      currentOwnerNode = eff;
      const b = boundary;
      let result: unknown;
      try {
        result = fn();
      } finally {
        effectStack.pop();
        currentOwnerNode = prevOwner;
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

export function derived<T>(fn: () => T): () => T {
  let value: T;
  let dirty = true;
  const subscribers = new Set<Effect>();
  const parent = currentOwnerNode;
  const computed: Effect = {
    deps: new Set(),
    children: new Set(),
    cleanups: [],
    disposed: false,
    schedule() {
      if (computed.disposed || dirty) return;
      dirty = true;
      const active = currentEffect();
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
    effectStack.push(computed);
    const prevOwner = currentOwnerNode;
    currentOwnerNode = computed;
    try {
      value = fn();
      dirty = false;
      return value;
    } finally {
      effectStack.pop();
      currentOwnerNode = prevOwner;
    }
  };

  return () => {
    const eff = currentEffect();
    if (eff) {
      subscribers.add(eff);
      eff.deps.add(subscribers);
    }
    return dirty ? recompute() : value;
  };
}

export type { Effect };
