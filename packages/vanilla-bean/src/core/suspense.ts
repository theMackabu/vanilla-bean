import { makeSignal, effect, withBoundary, type Boundary } from "./reactive.ts";
import { claim, withCursor, buildFresh, type Props } from "./dom.ts";
import { isRedirect } from "./request.ts";

type Render = () => unknown;

export function Suspense(props: Props): HTMLElement {
  const render = asFn(props.children);
  const pending = makeSignal(0);
  const error = makeSignal<unknown>(null);
  const container = box();

  let content: Node[];
  let hydrated: boolean;
  if (container.hasAttribute && container.hasAttribute("data-fb")) {
    container.removeAttribute("data-fb");
    content = buildFresh(() => build({ pending, fail: (e) => error(e) }, render, error));
    hydrated = false;
  } else {
    [content, hydrated] = buildContent(container, { pending, fail: (e) => error(e) }, render, error);
  }

  let first = true;
  effect(() => {
    const err = error();
    const loading = pending() > 0;
    const show = err || loading;
    if (import.meta.env?.SSR) show ? container.setAttribute("data-fb", "") : container.removeAttribute("data-fb");
    if (first) {
      first = false;
      if (!show && hydrated) return;
    }
    const nodes = show ? buildFresh(() => toNodes(call(props.fallback, { loading, error: err }))) : content;
    container.replaceChildren(...nodes);
  });
  return container;
}

export function ErrorBoundary(props: Props): HTMLElement {
  const render = asFn(props.children);
  const error = makeSignal<unknown>(null);
  const container = box();
  const [content, hydrated] = buildContent(container, { fail: (e) => error(e) }, render, error);

  let first = true;
  effect(() => {
    const err = error();
    if (first) {
      first = false;
      if (!err && hydrated) return;
    }
    const nodes = err ? buildFresh(() => toNodes(call(props.fallback, err))) : content;
    container.replaceChildren(...nodes);
  });
  return container;
}

function buildContent(
  container: HTMLElement,
  ctx: Boundary,
  render: Render,
  error: (e: unknown) => void,
): [Node[], boolean] {
  const built = withCursor(container.firstChild, () => build(ctx, render, error));
  if (container.firstChild) return [[...container.childNodes], true];
  return [built, false];
}

function build(ctx: Boundary, render: Render, error: (e: unknown) => void): Node[] {
  try {
    return toNodes(withBoundary(ctx, render));
  } catch (e) {
    if (isRedirect(e)) throw e;
    error(e);
    return [];
  }
}

const asFn = (children: unknown): Render => (typeof children === "function" ? (children as Render) : () => children);
const call = (fb: unknown, arg: unknown): unknown =>
  typeof fb === "function" ? (fb as (a: unknown) => unknown)(arg) : fb;

function box(): HTMLElement {
  const c = (claim("div") as HTMLElement) || document.createElement("div");
  c.style.display = "contents";
  return c;
}

function toNodes(v: unknown): Node[] {
  if (v == null || v === false) return [];
  if (Array.isArray(v)) return v.flatMap(toNodes);
  if (v && (v as Node).nodeType === 11) return [...(v as DocumentFragment).childNodes];
  if (v instanceof Node) return [v];
  return [document.createTextNode(String(v))];
}
