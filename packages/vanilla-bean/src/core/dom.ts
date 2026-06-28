import { effect, disposeChildren, trackServer } from "./reactive.ts";
import { __formAction } from "./actions.ts";
import type { Ctx } from "./ctx.ts";

export type Child = Node | string | number | boolean | null | undefined | Child[] | (() => Child);
export type Children = Child;
export type Props = Record<string, any> & { children?: Children };

export type Component = {
  (ctx: Ctx, props: Props): unknown;
  __mode?: string;
  __key?: string;
  fallback?: (ctx: Ctx, p: Props) => unknown;
};

const EMPTY_PROPS: Props = {};

type Thunk = { (): unknown; dyn?: boolean };

const isEventProp = (key: string): boolean => /^on[A-Z]/.test(key);
export const __dyn = (fn: Thunk): Thunk => ((fn.dyn = true), fn);

export const __use = (ctx: Ctx, comp: any): any =>
  comp && comp.__vbctx ? (...args: unknown[]) => comp(ctx, ...(args as [Props])) : comp;

export const __call = (ctx: Ctx, fn: any, ...args: unknown[]): unknown =>
  fn && fn.__vbctx ? fn(ctx, ...args) : fn(...args);

export function withCursor<T>(ctx: Ctx, first: Node | null, fn: () => T): T {
  const savedCursor = ctx.cursor;
  const savedHydrating = ctx.hydrating;
  ctx.cursor = first;
  if (first) ctx.hydrating = true;
  try {
    return fn();
  } finally {
    ctx.cursor = savedCursor;
    ctx.hydrating = savedHydrating;
  }
}

export function claim(ctx: Ctx, tag: string): Element | null {
  return ctx.cursor ? adoptEl(ctx, tag) : null;
}

function adoptEl(ctx: Ctx, tag: string): Element | null {
  const n = ctx.cursor;
  if (n && n.nodeType === 1 && (n as Element).tagName.toLowerCase() === tag) {
    ctx.cursor = n.nextSibling;
    return n as Element;
  }
  if (n)
    console.error(
      `[hydrate] mismatch: expected <${tag}>, found ${n.nodeName.toLowerCase()}, rebuilding from the client`,
    );
  return null;
}

export function __mark(comp: Component, mode: string, key: string): Component {
  comp.__mode = mode;
  comp.__key = key;
  (comp as any).__vbctx = 1;
  return comp;
}

export function collectAdopt(ctx: Ctx): void {
  ctx.adoptMap.clear();
  if (!ctx.doc) return;
  for (const n of ctx.doc.querySelectorAll('island[data-mode="static"]')) {
    const k = n.getAttribute("data-key");
    if (k) ctx.adoptMap.set(k, n);
  }
}

function islandWrapper(ctx: Ctx, mode: string, key?: string): HTMLElement {
  const d = ctx.doc.createElement("island") as HTMLElement;
  d.setAttribute("data-mode", mode);
  if (key) d.setAttribute("data-key", key);
  d.style.display = "contents";
  return d;
}

export function buildFresh<T>(ctx: Ctx, fn: () => T): T {
  const savedCursor = ctx.cursor;
  const savedHydrating = ctx.hydrating;
  ctx.cursor = null;
  ctx.hydrating = false;
  try {
    return fn();
  } finally {
    ctx.cursor = savedCursor;
    ctx.hydrating = savedHydrating;
  }
}

export function h(ctx: Ctx, tag: string | Component, props: Props | null, ...children: Child[]): any {
  if (typeof tag === "function") {
    const mode = tag.__mode;
    const child: Children = children.length <= 1 ? children[0] : children;

    const p: Props = props
      ? ((props.children = child), props)
      : child === undefined
        ? EMPTY_PROPS
        : { children: child };

    const call = () => tag(ctx, p);

    if (ctx.hydrating && (mode === "static" || mode === "server" || mode === "client")) {
      const slot = claim(ctx, "island");
      if (mode === "static" || mode === "server") return slot || buildFresh(ctx, call);
      const real = buildFresh(ctx, call);
      if (slot) (slot as Element).replaceWith(real as Node);
      return real;
    }

    if (!import.meta.env?.SSR && mode === "static" && tag.__key && ctx.adoptMap.has(tag.__key)) {
      const n = ctx.adoptMap.get(tag.__key)!;
      ctx.adoptMap.delete(tag.__key);
      return n;
    }

    if (!import.meta.env?.SSR && mode === "server") {
      return islandWrapper(ctx, "server", tag.__key);
    }

    if (import.meta.env?.SSR && mode === "client") {
      const w = islandWrapper(ctx, "client", tag.__key);
      if (typeof tag.fallback === "function") appendChild(ctx, w, tag.fallback(ctx, p));
      return w;
    }

    if (import.meta.env?.SSR && mode === "server") {
      const w = islandWrapper(ctx, "server", tag.__key);
      const out: unknown = call();
      if (out && typeof (out as Promise<unknown>).then === "function") {
        w.setAttribute("data-fb", "");
        trackServer(
          ctx,
          Promise.resolve(out).then((node) => {
            appendChild(ctx, w, node);
            w.removeAttribute("data-fb");
          }),
        );
      } else {
        appendChild(ctx, w, out);
      }
      return w;
    }

    const node = call();
    if (import.meta.env?.SSR && mode === "static") {
      const w = islandWrapper(ctx, "static", tag.__key);
      appendChild(ctx, w, node);
      return w;
    }
    return node;
  }

  const found = ctx.cursor ? adoptEl(ctx, tag) : null;
  const el = (found as HTMLElement) || ctx.doc.createElement(tag);
  const parentNext = ctx.cursor;

  if (props) {
    for (const key in props) {
      const value = props[key];
      const action = key === "action" && typeof value === "function" ? (value.__actionId ? value : value()) : null;
      if (action && action.__actionId) {
        const url = "/_vanilla/actions/" + encodeURIComponent(action.__actionId);
        el.setAttribute("action", url);
        if (!props.method) el.setAttribute("method", "post");
        if (!import.meta.env?.SSR) el.addEventListener("submit", (e: any) => __formAction(ctx, url, e));
      } else if (isEventProp(key)) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (typeof value === "function") effect(ctx, () => setProp(el, key, value()));
      else if (!found) setProp(el, key, value);
    }
  }

  ctx.cursor = found ? el.firstChild : null;
  appendChild(ctx, el, children);
  ctx.cursor = parentNext;
  return el;
}

function setProp(el: any, key: string, value: any): void {
  if (key === "children") return;
  if (key === "class" || key === "className") {
    el.className = value == null ? "" : value;
  } else if (key === "style" && value && typeof value === "object") {
    Object.assign(el.style, value);
  } else if (key in el) {
    try {
      el[key] = value;
    } catch {
      el.setAttribute(key, value);
    }
  } else if (value == null || value === false) {
    el.removeAttribute(key);
  } else {
    el.setAttribute(key, value === true ? "" : value);
  }
}

function appendChild(ctx: Ctx, parent: Node, child: unknown): void {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) appendChild(ctx, parent, c);
  } else if (typeof child === "function") {
    if ((child as Thunk).dyn) insertDynamic(ctx, parent, child as Thunk);
    else appendChild(ctx, parent, (child as Thunk)());
  } else if (child instanceof ctx.Node) {
    if (ctx.hydrating && (child as Node).parentNode) return;
    parent.appendChild(child as Node);
  } else {
    const s = String(child);
    if (ctx.cursor && ctx.cursor.nodeType === 3) {
      const n = ctx.cursor as Text;
      if (n.data === s) {
        ctx.cursor = n.nextSibling;
        return;
      }
      if (n.data.startsWith(s)) {
        const rest = ctx.doc.createTextNode(n.data.slice(s.length));
        n.data = s;
        parent.insertBefore(rest, n.nextSibling);
        ctx.cursor = rest;
        return;
      }
    }
    parent.appendChild(ctx.doc.createTextNode(s));
  }
}

function insertDynamic(ctx: Ctx, parent: Node, thunk: Thunk): void {
  let anchor: Node;
  let current: Node[] = [];
  if (ctx.cursor) {
    while (ctx.cursor && ctx.cursor.nodeType !== 8) {
      current.push(ctx.cursor);
      ctx.cursor = ctx.cursor.nextSibling;
    }
    if (ctx.cursor) {
      anchor = ctx.cursor;
      ctx.cursor = ctx.cursor.nextSibling;
    } else {
      anchor = ctx.doc.createComment("");
      parent.appendChild(anchor);
    }
  } else {
    anchor = ctx.doc.createComment("");
    parent.appendChild(anchor);
  }

  let owner: ReturnType<typeof effect>;
  owner = effect(ctx, () => {
    let value = thunk();
    if (value && (value as any).__vbsignal) value = (value as any)(ctx);
    if (
      (typeof value === "string" || typeof value === "number") &&
      current.length === 1 &&
      current[0]!.nodeType === 3
    ) {
      (current[0] as Text).data = String(value);
      return;
    }
    disposeChildren(owner);
    const frag = ctx.doc.createDocumentFragment();
    appendChild(ctx, frag, value);
    const next = [...frag.childNodes];
    for (const n of current) (n as ChildNode).remove();
    parent.insertBefore(frag, anchor);
    current = next;
  });
}

function toNodes(ctx: Ctx, value: unknown): Node[] {
  if (value == null || value === false || value === true) return [];
  if (Array.isArray(value)) return value.flatMap((v) => toNodes(ctx, v));
  if (value instanceof ctx.Node) return [value as Node];
  return [ctx.doc.createTextNode(String(value))];
}

function applyProps(ctx: Ctx, el: HTMLElement, props: Props): void {
  for (const key in props) {
    const value = props[key];
    if (key === "children") continue;
    if (isEventProp(key)) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (typeof value === "function") effect(ctx, () => setProp(el, key, value()));
    else setProp(el, key, value);
  }
}

export function For(props: Props): any;
export function For(ctx: Ctx, props: Props): any;
export function For(ctxOrProps: Ctx | Props, props: Props = EMPTY_PROPS): any {
  const ctx = ctxOrProps as Ctx;
  const each = props.each as () => unknown[];
  const render = props.children as (item: unknown, index: number) => Node;
  const keyOf = (props.key as (item: unknown, index: number) => unknown) || ((item: unknown) => item);
  const as = props.as as string | Component | undefined;

  let map = new Map<unknown, Node>();

  let box: any;
  let start: Node | undefined;
  if (as != null) {
    const tag = typeof as === "string" ? as : "div";
    box = claim(ctx, tag) || ctx.doc.createElement(tag);
    if (typeof as !== "string") box.style.display = "contents";
  } else if (ctx.hydrating && ctx.cursor && ctx.cursor.nodeType === 8) {
    start = ctx.cursor;
    ctx.cursor = ctx.cursor.nextSibling;
    box = start.parentNode;
  } else {
    box = ctx.doc.createDocumentFragment();
    start = ctx.doc.createComment("for");
    box.append(start, ctx.doc.createComment("/for"));
  }

  let firstRun = true;
  let prevItems: unknown[] | null = null;
  effect(ctx, () => {
    const items = each() || [];

    if (firstRun && ctx.hydrating) {
      firstRun = false;
      withCursor(ctx, as != null ? box.firstChild : start!.nextSibling, () => {
        for (let i = 0; i < items.length; i++) map.set(keyOf(items[i], i), render(items[i], i));
        if (as == null && ctx.cursor && ctx.cursor.nodeType === 8) ctx.cursor = ctx.cursor.nextSibling;
      });
      prevItems = items;
      return;
    }
    if (!firstRun && items === prevItems) return;
    firstRun = false;
    prevItems = items;

    const parent = start ? start.parentNode! : box;
    const nextMap = new Map<unknown, Node>();
    let prev: Node | undefined = start;

    items.forEach((item, i) => {
      const key = keyOf(item, i);
      const node = map.get(key) || render(item, i);
      nextMap.set(key, node);
      const ref = prev ? prev.nextSibling : box.firstChild;
      if (ref !== node) parent.insertBefore(node, ref);
      prev = node;
    });

    for (const [key, node] of map) if (!nextMap.has(key)) (node as ChildNode).remove();
    map = nextMap;
  });

  if (as == null) return box;
  const { each: _e, children: _c, key: _k, as: _a, ...rest } = props;
  if (typeof as === "string") {
    applyProps(ctx, box, rest);
    return box;
  }
  return h(ctx, as, rest, box);
}

export function Fragment(props: Props): DocumentFragment;
export function Fragment(ctx: Ctx, props: Props): DocumentFragment;
export function Fragment(ctxOrProps: Ctx | Props, props: Props = EMPTY_PROPS): DocumentFragment {
  const ctx = ctxOrProps as Ctx;
  const frag = ctx.doc.createDocumentFragment();
  appendChild(ctx, frag, props.children);
  return frag;
}

export function Head(props: Props): DocumentFragment;
export function Head(ctx: Ctx, props: Props): DocumentFragment;
export function Head(ctxOrProps: Ctx | Props, props: Props = EMPTY_PROPS): DocumentFragment {
  const ctx = ctxOrProps as Ctx;
  const frag = ctx.doc.createDocumentFragment();
  buildFresh(ctx, () => appendChild(ctx, frag, props.children));
  for (const node of [...frag.childNodes]) if (node.nodeType === 1) ctx.pendingHead.push(node as Element);
  return ctx.doc.createDocumentFragment();
}

export function clearHead(ctx: Ctx): void {
  ctx.pendingHead = [];
  for (const n of ctx.doc.head.querySelectorAll("[data-head]")) n.remove();
}

export function flushHead(ctx: Ctx): void {
  for (let i = 0; i < ctx.layoutHead.length; i++) applyHead(ctx, ctx.layoutHead[i]!);
  for (let i = 0; i < ctx.pendingHead.length; i++) applyHead(ctx, ctx.pendingHead[i]!);
  ctx.pendingHead = [];
}

function applyHead(ctx: Ctx, node: Element): void {
  if (node.tagName === "TITLE") {
    ctx.doc.title = node.textContent || "";
    return;
  }
  const key = node.getAttribute?.("name") || node.getAttribute?.("property");
  if (key) {
    const attr = node.getAttribute("name") ? "name" : "property";
    ctx.doc.head.querySelector(`meta[${attr}="${key}"]`)?.remove();
  }
  node.setAttribute("data-head", "");
  ctx.doc.head.appendChild(node);
}

export { toNodes, applyProps };
