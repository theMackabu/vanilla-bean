import type { Ctx, Redirect } from "./ctx.ts";

export function getRequest(ctx: Ctx): Request {
  if (!ctx.request) throw new Error("getRequest() is only available on the server, during a request");
  return ctx.request;
}
export function headers(ctx: Ctx): Headers {
  return getRequest(ctx).headers;
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

type CookieOptions = {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
};

function serializeCookie(name: string, value: string, o: CookieOptions): string {
  let s = `${name}=${encodeURIComponent(value)}`;
  s += `; Path=${o.path ?? "/"}`;
  if (o.domain) s += `; Domain=${o.domain}`;
  if (o.maxAge != null) s += `; Max-Age=${o.maxAge}`;
  if (o.expires) s += `; Expires=${o.expires.toUTCString()}`;
  if (o.httpOnly) s += `; HttpOnly`;
  if (o.secure) s += `; Secure`;
  if (o.sameSite) s += `; SameSite=${o.sameSite[0].toUpperCase()}${o.sameSite.slice(1)}`;
  return s;
}

export function cookies(ctx: Ctx) {
  const jar = parseCookies(ctx.request?.headers.get("cookie") || "");
  return {
    get: (name: string): string | undefined => jar[name],
    set: (name: string, value: string, options: CookieOptions = {}): void => {
      ctx.resHeaders.append("set-cookie", serializeCookie(name, value, options));
    },
    delete: (name: string, options: CookieOptions = {}): void => {
      ctx.resHeaders.append("set-cookie", serializeCookie(name, "", { ...options, maxAge: 0 }));
    },
  };
}

export function setHeader(ctx: Ctx, name: string, value: string): void {
  ctx.resHeaders.set(name, value);
}

export function getResponseHeaders(ctx: Ctx): Headers {
  return ctx.resHeaders;
}
export function getRedirect(ctx: Ctx): Redirect | null {
  return ctx.redirect;
}

class RedirectError extends Error {
  redirect: Redirect;
  constructor(redirect: Redirect) {
    super(`redirect: ${redirect.url}`);
    this.redirect = redirect;
  }
}

export function redirect(ctx: Ctx, url: string, status = 302): never {
  ctx.redirect = { url, status };
  throw new RedirectError(ctx.redirect);
}

export function isRedirect(err: unknown): boolean {
  return err instanceof RedirectError;
}
