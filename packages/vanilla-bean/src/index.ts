declare global {
  namespace JSX {
    type Element = any;
    interface ElementChildrenAttribute {
      children: {};
    }
    interface IntrinsicElements {
      [el: string]: any;
    }
  }

  const Fragment: any;

  interface ImportMeta {
    env?: { SSR?: boolean; [k: string]: unknown };
    glob(pattern: string): Record<string, () => Promise<any>>;
  }
}

export type { Signal } from './core/reactive.ts';
export type { Ctx, Loc } from './core/ctx.ts';
export type { Child, Children, Props } from './core/dom.ts';

export { makeCtx } from './core/ctx.ts';
export { Suspense, ErrorBoundary } from './core/suspense.ts';
export { __action, __register, runAction, hasAction } from './core/actions.ts';
export { h, Fragment, Head, For, __mark, __dyn, __use, __call } from './core/dom.ts';
export { signal, makeSignal, effect, derived, onCleanup, trackAsync, settle, untrackAsync } from './core/reactive.ts';
export { useTransition, startTransition, isTransitioning } from './core/reactive.ts';
export { getRequest, cookies, headers, setHeader, redirect } from './core/request.ts';
export { getResponseHeaders, getRedirect, isRedirect } from './core/request.ts';
export { installTimerGuard } from './core/guard.ts';

export {
  start,
  routes,
  navigate,
  revalidate,
  useLocation,
  matchRoute,
  renderRouteToDocument,
  __static,
  setStaticData,
  preloadAll,
  collectStatics
} from './core/router.ts';
