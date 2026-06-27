import type { Effect, Owner, Boundary, Signal } from "./reactive.ts";

export type Loc = {
  path: string;
  query: Record<string, string>;
  search: string;
  hash: string;
  params: Record<string, unknown>;
};

export type Redirect = {
  url: string;
  status: number;
};

export type Ctx = {
  doc: Document;
  Node: any;
  cursor: Node | null;
  hydrating: boolean;
  adoptMap: Map<string, Element>;
  pendingHead: Element[];
  layoutHead: Element[];
  listeners: Effect[];
  owner: Owner | null;
  boundary: Boundary | null;
  tracker: Set<Promise<unknown>> | null;
  url: URL;
  loc: Signal<Loc> | null;
  request: Request | null;
  resHeaders: Headers;
  redirect: Redirect | null;
  dynamic: boolean;
  committed: boolean;
  matchedParams: Record<string, unknown>;
  mounted: any[];
  pageOwner: Owner | null;
  booted: boolean;
  rootEl: any;
  transitions: boolean;
};

export function makeCtx(
  doc: any,
  Node: any,
  opts: {
    url?: URL;
    request?: Request | null;
  } = {},
): Ctx {
  return {
    doc,
    Node,
    cursor: null,
    hydrating: false,
    adoptMap: new Map(),
    pendingHead: [],
    layoutHead: [],
    listeners: [],
    owner: null,
    boundary: null,
    tracker: null,
    url: opts.url ?? new URL("http://localhost/"),
    loc: null,
    request: opts.request ?? null,
    resHeaders: new Headers(),
    redirect: null,
    dynamic: false,
    committed: false,
    matchedParams: {},
    mounted: [],
    pageOwner: null,
    booted: false,
    rootEl: null,
    transitions: false,
  };
}
