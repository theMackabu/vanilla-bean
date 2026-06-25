import { makeSignal, effect, withBoundary, type Boundary } from "./reactive.ts";
import { claim, withCursor, buildFresh, type Props } from "./dom.ts";
import { isRedirect } from "./request.ts";
import type { Ctx } from "./ctx.ts";

type Render = () => unknown;

export function Suspense(ctx: Ctx, props: Props): HTMLElement {
  const render = asFn(props.children);
  const pending = makeSignal(ctx, 0);
  const error = makeSignal<unknown>(ctx, null);
  const container = box(ctx);

  let content: Node[];
  let hydrated: boolean;
  if (container.hasAttribute && container.hasAttribute("data-fb")) {
    container.removeAttribute("data-fb");
    content = buildFresh(ctx, () => build(ctx, { pending, fail: (e) => error(e) }, render, error));
    hydrated = false;
  } else {
    [content, hydrated] = buildContent(ctx, container, { pending, fail: (e) => error(e) }, render, error);
  }

  let first = true;
  effect(ctx, () => {
    const err = error();
    const loading = pending() > 0;
    const show = err || loading;
    if (import.meta.env?.SSR) show ? container.setAttribute("data-fb", "") : container.removeAttribute("data-fb");
    if (first) {
      first = false;
      if (!show && hydrated) return;
    }
    const nodes = show ? buildFresh(ctx, () => toNodes(ctx, call(props.fallback, { loading, error: err }))) : content;
    container.replaceChildren(...nodes);
  });
  return container;
}

export function ErrorBoundary(ctx: Ctx, props: Props): HTMLElement {
  const render = asFn(props.children);
  const error = makeSignal<unknown>(ctx, null);
  const container = box(ctx);
  const [content, hydrated] = buildContent(ctx, container, { fail: (e) => error(e) }, render, error);

  let first = true;
  effect(ctx, () => {
    const err = error();
    if (first) {
      first = false;
      if (!err && hydrated) return;
    }
    const nodes = err ? buildFresh(ctx, () => toNodes(ctx, call(props.fallback, err))) : content;
    container.replaceChildren(...nodes);
  });
  return container;
}

function buildContent(
  ctx: Ctx,
  container: HTMLElement,
  boundary: Boundary,
  render: Render,
  error: (e: unknown) => void,
): [Node[], boolean] {
  const built = withCursor(ctx, container.firstChild, () => build(ctx, boundary, render, error));
  if (container.firstChild) return [[...container.childNodes], true];
  return [built, false];
}

function build(ctx: Ctx, boundary: Boundary, render: Render, error: (e: unknown) => void): Node[] {
  try {
    return toNodes(ctx, withBoundary(ctx, boundary, render));
  } catch (e) {
    if (isRedirect(e)) throw e;
    error(e);
    return [];
  }
}

const asFn = (children: unknown): Render => (typeof children === "function" ? (children as Render) : () => children);
const call = (fb: unknown, arg: unknown): unknown =>
  typeof fb === "function" ? (fb as (a: unknown) => unknown)(arg) : fb;

function box(ctx: Ctx): HTMLElement {
  const c = (claim(ctx, "div") as HTMLElement) || ctx.doc.createElement("div");
  c.style.display = "contents";
  return c;
}

function toNodes(ctx: Ctx, v: unknown): Node[] {
  if (v == null || v === false) return [];
  if (Array.isArray(v)) return v.flatMap((x) => toNodes(ctx, x));
  if (v && (v as Node).nodeType === 11) return [...(v as DocumentFragment).childNodes];
  if (v instanceof ctx.Node) return [v as Node];
  return [ctx.doc.createTextNode(String(v))];
}
