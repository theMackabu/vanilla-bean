import { effect, disposeChildren, trackServer } from "./reactive.ts";

export type Props = Record<string, any> & { children?: unknown };

export type Component = {
  (props: Props): unknown;
  __mode?: string;
  __key?: string;
  fallback?: (p: Props) => unknown;
};

const EMPTY_PROPS: Props = {};
let serverIslandContent = new Map<string, string>();

export function setServerIslandContent(content: Map<string, string> | null): void {
  serverIslandContent = content || new Map();
}

type Thunk = { (): unknown; dyn?: boolean };

const isEventProp = (key: string): boolean => /^on[A-Z]/.test(key);
export const __dyn = (fn: Thunk): Thunk => ((fn.dyn = true), fn);

let cursor: Node | null = null;
let hydrating = false;

export function withCursor<T>(first: Node | null, fn: () => T): T {
  const savedCursor = cursor;
  const savedHydrating = hydrating;
  cursor = first;
  if (first) hydrating = true;
  try {
    return fn();
  } finally {
    cursor = savedCursor;
    hydrating = savedHydrating;
  }
}

export function claim(tag: string): Element | null {
  return cursor ? adoptEl(tag) : null;
}

function adoptEl(tag: string): Element | null {
  const n = cursor;
  if (n && n.nodeType === 1 && (n as Element).tagName.toLowerCase() === tag) {
    cursor = n.nextSibling;
    return n as Element;
  }
  if (n)
    console.error(
      `[hydrate] mismatch: expected <${tag}>, found ${n.nodeName.toLowerCase()}, rebuilding from the client`,
    );
  return null;
}

const adoptMap = new Map<string, Element>();

export function __mark(comp: Component, mode: string, key: string): Component {
  comp.__mode = mode;
  comp.__key = key;
  return comp;
}

export function collectAdopt(): void {
  adoptMap.clear();
  if (typeof document === "undefined") return;
  for (const n of document.querySelectorAll('island[data-mode="static"]')) {
    const k = n.getAttribute("data-key");
    if (k) adoptMap.set(k, n);
  }
}

function islandWrapper(mode: string, key?: string): HTMLElement {
  const d = document.createElement("island") as HTMLElement;
  d.setAttribute("data-mode", mode);
  if (key) d.setAttribute("data-key", key);
  d.style.display = "contents";
  return d;
}

export function buildFresh<T>(fn: () => T): T {
  const savedCursor = cursor;
  const savedHydrating = hydrating;
  cursor = null;
  hydrating = false;
  try {
    return fn();
  } finally {
    cursor = savedCursor;
    hydrating = savedHydrating;
  }
}

export function h(tag: string | Component, props: Props | null, ...children: unknown[]): any {
  if (typeof tag === "function") {
    const mode = tag.__mode;
    const child = children.length <= 1 ? children[0] : children;

    const p: Props = props
      ? ((props.children = child), props)
      : child === undefined
        ? EMPTY_PROPS
        : { children: child };

    const call = () => tag(p);

    if (hydrating && (mode === "static" || mode === "server" || mode === "client")) {
      const slot = claim("island");
      if (mode === "static" || mode === "server") return slot || buildFresh(call);
      const real = buildFresh(call);
      if (slot) (slot as Element).replaceWith(real as Node);
      return real;
    }

    if (!import.meta.env?.SSR && mode === "static" && tag.__key && adoptMap.has(tag.__key)) {
      const n = adoptMap.get(tag.__key)!;
      adoptMap.delete(tag.__key);
      return n;
    }

    if (!import.meta.env?.SSR && mode === "server") {
      const w = islandWrapper("server", tag.__key);
      const html = tag.__key ? serverIslandContent.get(tag.__key) : null;
      if (html != null) w.innerHTML = html;
      return w;
    }

    if (import.meta.env?.SSR && mode === "client") {
      const w = islandWrapper("client", tag.__key);
      if (typeof tag.fallback === "function") appendChild(w, tag.fallback(p));
      return w;
    }

    if (import.meta.env?.SSR && mode === "server") {
      const w = islandWrapper("server", tag.__key);
      const out: unknown = call();
      if (out && typeof (out as Promise<unknown>).then === "function") {
        w.setAttribute("data-fb", "");
        trackServer(
          Promise.resolve(out).then((node) => {
            appendChild(w, node);
            w.removeAttribute("data-fb");
          }),
        );
      } else {
        appendChild(w, out);
      }
      return w;
    }

    const node = call();
    if (import.meta.env?.SSR && mode === "static") {
      const w = islandWrapper("static", tag.__key);
      appendChild(w, node);
      return w;
    }
    return node;
  }

  const found = cursor ? adoptEl(tag) : null;
  const el = (found as HTMLElement) || document.createElement(tag);
  const parentNext = cursor;

  if (props) {
    for (const key in props) {
      const value = props[key];
      if (isEventProp(key)) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (typeof value === "function") effect(() => setProp(el, key, value()));
      else if (!found) setProp(el, key, value);
    }
  }

  cursor = found ? el.firstChild : null;
  appendChild(el, children);
  cursor = parentNext;
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

function appendChild(parent: Node, child: unknown): void {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) appendChild(parent, c);
  } else if (typeof child === "function") {
    if ((child as Thunk).dyn) insertDynamic(parent, child as Thunk);
    else appendChild(parent, (child as Thunk)());
  } else if (child instanceof Node) {
    if (hydrating && child.parentNode) return;
    parent.appendChild(child);
  } else {
    const s = String(child);
    if (cursor && cursor.nodeType === 3) {
      const n = cursor as Text;
      if (n.data === s) {
        cursor = n.nextSibling;
        return;
      }
      if (n.data.startsWith(s)) {
        const rest = document.createTextNode(n.data.slice(s.length));
        n.data = s;
        parent.insertBefore(rest, n.nextSibling);
        cursor = rest;
        return;
      }
    }
    parent.appendChild(document.createTextNode(s));
  }
}

function insertDynamic(parent: Node, thunk: Thunk): void {
  let anchor: Node;
  let current: Node[] = [];
  if (cursor) {
    while (cursor && cursor.nodeType !== 8) {
      current.push(cursor);
      cursor = cursor.nextSibling;
    }
    if (cursor) {
      anchor = cursor;
      cursor = cursor.nextSibling;
    } else {
      anchor = document.createComment("");
      parent.appendChild(anchor);
    }
  } else {
    anchor = document.createComment("");
    parent.appendChild(anchor);
  }

  let owner: ReturnType<typeof effect>;
  owner = effect(() => {
    const value = thunk();
    if (
      (typeof value === "string" || typeof value === "number") &&
      current.length === 1 &&
      current[0]!.nodeType === Node.TEXT_NODE
    ) {
      (current[0] as Text).data = String(value);
      if ((globalThis as any).__REACTIVE_DEBUG__) console.log("[reactive] text node updated in place ->", value);
      return;
    }
    disposeChildren(owner);
    const frag = document.createDocumentFragment();
    appendChild(frag, value);
    const next = [...frag.childNodes];
    for (const n of current) (n as ChildNode).remove();
    parent.insertBefore(frag, anchor);
    current = next;
  });
}

function toNodes(value: unknown): Node[] {
  if (value == null || value === false || value === true) return [];
  if (Array.isArray(value)) return value.flatMap(toNodes);
  if (value instanceof Node) return [value];
  return [document.createTextNode(String(value))];
}

function applyProps(el: HTMLElement, props: Props): void {
  for (const key in props) {
    const value = props[key];
    if (key === "children") continue;
    if (isEventProp(key)) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (typeof value === "function") effect(() => setProp(el, key, value()));
    else setProp(el, key, value);
  }
}

export function For(props: Props): any {
  const each = props.each as () => unknown[];
  const render = props.children as (item: unknown, index: number) => Node;
  const keyOf = (props.key as (item: unknown, index: number) => unknown) || ((item: unknown) => item);
  const as = props.as as string | Component | undefined;

  let map = new Map<unknown, Node>();

  let box: any;
  let start: Node | undefined;
  if (as != null) {
    const tag = typeof as === "string" ? as : "div";
    box = claim(tag) || document.createElement(tag);
    if (typeof as !== "string") box.style.display = "contents";
  } else if (hydrating && cursor && cursor.nodeType === 8) {
    start = cursor;
    cursor = cursor.nextSibling;
    box = start.parentNode;
  } else {
    box = document.createDocumentFragment();
    start = document.createComment("for");
    box.append(start, document.createComment("/for"));
  }

  let firstRun = true;
  let prevItems: unknown[] | null = null;
  effect(() => {
    const items = each() || [];

    if (firstRun && hydrating) {
      firstRun = false;
      withCursor(as != null ? box.firstChild : start!.nextSibling, () => {
        for (let i = 0; i < items.length; i++) map.set(keyOf(items[i], i), render(items[i], i));
        if (as == null && cursor && cursor.nodeType === 8) cursor = cursor.nextSibling;
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
    applyProps(box, rest);
    return box;
  }
  return h(as, rest, box);
}

export function Fragment(props: Props): DocumentFragment {
  const frag = document.createDocumentFragment();
  appendChild(frag, props.children);
  return frag;
}

let pendingHead: Element[] = [];

export function Head(props: Props): DocumentFragment {
  const frag = document.createDocumentFragment();
  buildFresh(() => appendChild(frag, props.children));
  for (const node of [...frag.childNodes]) if (node.nodeType === Node.ELEMENT_NODE) pendingHead.push(node as Element);
  return document.createDocumentFragment();
}

export function clearHead(): void {
  pendingHead = [];
  for (const n of document.head.querySelectorAll("[data-head]")) n.remove();
}

export function flushHead(): void {
  for (let i = pendingHead.length - 1; i >= 0; i--) applyHead(pendingHead[i]!);
  pendingHead = [];
}

function applyHead(node: Element): void {
  if (node.tagName === "TITLE") {
    document.title = node.textContent || "";
    return;
  }
  const key = node.getAttribute?.("name") || node.getAttribute?.("property");
  if (key) {
    const attr = node.getAttribute("name") ? "name" : "property";
    document.head.querySelector(`meta[${attr}="${key}"]`)?.remove();
  }
  node.setAttribute("data-head", "");
  document.head.appendChild(node);
}

export { toNodes, applyProps };
