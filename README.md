# 🫘 vanilla bean

_Real DOM. Real signals. No virtual anything._

vanilla bean is a JSX framework that compiles your components straight to **real DOM nodes** and wires them with **fine-grained signals**. There's no virtual DOM, no diffing, and no re-rendering, when a signal changes, only the one text node or attribute that read it updates.

```jsx
import { signal } from "vanilla-bean";

function Counter() {
  let count = signal(0);
  return <button onClick={() => count++}>count: {count}</button>;
}
```

`{count}` is the only thing that updates when you click. No component re-runs.

## Table of contents

- [Why vanilla bean?](#why-vanilla-bean)
- [Quick start](#quick-start)
- [Reactivity](#reactivity)
- [Routing](#routing)
- [Islands & directives](#islands--directives)
- [Server actions](#server-actions)
- [Request, cookies & redirect](#request-cookies--redirect)
- [API routes & WebSockets](#api-routes--websockets)
- [Data & streaming](#data--streaming)
- [CLI](#cli)
- [Runtimes](#runtimes)
- [Project structure](#project-structure)

## Why vanilla bean?

|                      | vanilla bean         | typical SPA       |
| -------------------- | -------------------- | ----------------- |
| Rendering            | JSX → real DOM       | JSX → virtual DOM |
| Updates              | fine-grained signals | re-render + diff  |
| Hydration            | adopt server DOM     | wipe & rebuild    |
| Server components    | `async` + `await`    | n/a               |
| SSR                  | streaming            | varies            |
| Ships to the browser | only the islands     | the whole tree    |

- **No virtual DOM.** `h()` builds DOM. Effects bind to nodes. A signal write touches exactly the nodes that read it.
- **Islands architecture.** Static content stays static; only interactive components ship JS. Server components ship _zero_ JS.
- **Streaming SSR + hydration.** The server streams a shell, then fills boundaries as they resolve. The client **adopts** the server DOM instead of throwing it away.
- **One directive system** `"use client"`, `"use static"`, `"use server"`, decides where each component runs.
- **Vite-powered, TypeScript-first**, runs on **ant, bun, node, or deno**.

## Quick start

Scaffold a new app

```bash
ant create vanilla-bean@latest
# works with any package manager's create: pnpm / bun / yarn create vanilla-bean
```

```bash
cd my-app
ant install
ant dev        # dev server with HMR
ant build      # static prerender + SSR bundle → .vanilla/
ant start      # serve the build on the detected runtime
```

A full example app lives in [`examples/demo`](examples/demo).

<details>
<summary>Manual setup</summary>

```bash
ant add vanilla-bean
```

```jsonc
// package.json
{
  "scripts": {
    "dev": "vanilla-bean dev",
    "build": "vanilla-bean build",
    "start": "vanilla-bean start",
  },
}
```

Then drop a page in `src/pages/`:

```jsx
// src/pages/index.jsx
import { Head } from "vanilla-bean";

export default () => (
  <Fragment>
    <Head>
      <title>hello</title>
    </Head>
    <h1>hello, bean</h1>
  </Fragment>
);
```

</details>

## Reactivity

`signal()` holds state. Read it to subscribe, write it to update. The compiler gives you sugar so signals read and write like plain variables:

```jsx
let count = signal(0); // `let`, not `const`, for signals you write to via the sugar

count++; // write
count = 10; // write
<span>{count}</span>; // read → this text node tracks `count`
```

`effect()` re-runs when any signal it read changes. `derived()` is a cached computed value, read it by calling it:

```jsx
import { signal, derived, effect } from "vanilla-bean";

const count = signal(1); // read-only here → `const` is fine
const doubled = derived(() => count * 2);

effect(() => console.log(doubled())); // logs whenever `count` changes
```

## Routing

File-based, under `src/pages/`:

| File                         | Route              |
| ---------------------------- | ------------------ |
| `pages/index.jsx`            | `/`                |
| `pages/about.jsx`            | `/about`           |
| `pages/users/[name].jsx`     | `/users/:name`     |
| `pages/blog/[...slug].jsx`   | catch-all          |
| `pages/docs/[[...slug]].jsx` | optional catch-all |
| `pages/layout.jsx`           | nested layout      |
| `pages/not-found.jsx`        | 404                |

Pages receive `params` (and `query`):

```jsx
export default ({ params }) => <h1>user: {params.name}</h1>;
```

## Islands & directives

By default a component is **isomorphic**: server-rendered for the initial HTML, then hydrated and interactive on the client. A directive changes where it runs:

```jsx
// "use static" runs ONCE at build, the result is baked into the page,
// and the client adopts it with no JS shipped for this component.
async function loadUUID() {
  "use static";
  return (await fetch("https://httpbingo.org/uuid")).json();
}

// "use client" server emits a placeholder/fallback; the component
// runs only in the browser.
function Widget() {
  "use client";
  // ...browser-only code
}

// "use server" a real async server component. Runs per request on the
// server with the real fetch, streams in, and the client adopts it
// statically. Zero JS shipped for this component.
async function Origin() {
  "use server";
  const data = await (await fetch("https://httpbingo.org/get")).json();
  return (
    <p>
      your origin: <code>{data.origin}</code>
    </p>
  );
}
```

> An `async` component **must** be `"use server"`, a client can't render an async component (it returns a Promise, not a node), so the build rejects it.

The same directives work as the **first line of a page file**, applying to the whole page, `"use static"` prerenders it at build, `"use client"` makes it client-only, `"use server"` server-renders it:

```jsx
"use server"; // the whole page renders on the server; named exports become actions

export default async function Page() {
  const data = await db.query(/* … */);
  return <pre>{JSON.stringify(data)}</pre>;
}
```

Routes whose page and layouts are all marked `"use client"` or `"use static"` are cached by default. SSR HTML is not cached by default; if a page is safe to share across requests, opt it into the server's in-memory HTML cache:

```jsx
export const cache = true;
```

Any layout in the route chain can veto that with `export const cache = false`.

## Server actions

A file that starts with `"use server"` turns its exports into server functions you can call from the client. The body never ships to the browser, module state lives on the server:

```jsx
// src/actions/demo.jsx
"use server";

let hits = 0; // shared across requests, on the server

export async function bump(by = 1) {
  hits += by;
  return { hits, at: new Date().toISOString() };
}
```

```jsx
import { bump } from "../actions/demo";
const res = await bump(2); // RPC to the server
```

(Action and page files can be `.js`/`.ts` as well — JSX is optional. A `.js` page can build DOM with `h()`, return a string, or just `redirect()`.)

## Request, cookies & redirect

Server components and server actions can read the incoming request — **cookies, headers, method** — and set response cookies/headers or redirect. Read it synchronously at the top (the server serializes renders, so the context is per-request).

```jsx
import { cookies, redirect } from "vanilla-bean";

// an auth gate: a sync "use server" component → a real 302 on first load
function Protected() {
  "use server";
  const user = cookies().get("session");
  if (!user) redirect("/login");
  return <p>welcome, {user}</p>;
}
```

```js
// src/actions/auth.js
"use server";
import { cookies, redirect } from "vanilla-bean";

export async function login(name) {
  cookies().set("session", name, { httpOnly: true, sameSite: "lax" });
  redirect("/"); // from an action, the client navigates
}
export async function logout() {
  cookies().delete("session");
  redirect("/login");
}
```

- `cookies()` — `.get(name)` reads a request cookie; `.set(name, value, opts)` / `.delete(name)` queue `Set-Cookie` on the response.
- `getRequest()` / `headers()` — the raw `Request` / its headers.
- `setHeader(name, value)` — set a response header.
- `redirect(url)` — a **server component** yields a real `302` (sync) or a client redirect (mid-stream); an **action** makes the client navigate; a client navigation to a server route is resolved through the nav payload. Auth-gated routes are skipped during the static prerender.

## API routes & WebSockets

Files under `src/api/` become HTTP endpoints. Export handlers by method:

```js
// src/api/hello.js  →  GET /api/hello
export function GET(request, { query }) {
  return { hello: query.name ?? "world" };
}

// src/api/users/[id].js  →  /api/users/:id
export function GET(request, { params }) {
  return { id: params.id };
}
export async function POST(request, { params }) {
  return { id: params.id, body: await request.json() };
}
```

A `*.ws.js` file is a WebSocket endpoint:

```js
// src/api/echo.ws.js  →  ws://…/api/echo
export function open(ws) {
  ws.send("connected");
}
export function message(ws, data) {
  ws.send("echo: " + data);
}
export function close() {}
```

## Data & streaming

`<Suspense>` shows a fallback until its async children resolve; `<ErrorBoundary>` catches throws:

```jsx
import { Suspense, ErrorBoundary } from "vanilla-bean";

<Suspense fallback={({ error }) => (error ? <p>failed: {error.message}</p> : <p>loading…</p>)}>
  <Origin />
</Suspense>

<ErrorBoundary fallback={(err) => <p>caught: {err.message}</p>}>
  <MightThrow />
</ErrorBoundary>
```

On the server, the shell flushes immediately and each boundary streams in as it settles. Async **effects** in client components don't run on the server, they show the fallback and run on the client at hydration, so there's no double-fetch and no neutralized network calls.

## CLI

```
vanilla-bean dev            dev server with HMR
vanilla-bean build          prerender static routes + build the SSR bundle
vanilla-bean build:client   client + prerender only
vanilla-bean preview        preview the production build
vanilla-bean start          build if stale, then serve
```

Configure with `vanilla-bean.config.{ts,js,mjs}`:

```ts
export default {
  meta: { lang: "en", title: "my app", description: "…" },
  vite: {
    plugins: [
      /* any vite plugins, e.g. tailwind */
    ],
  },
};
```

## Runtimes

`vanilla-bean start` detects the runtime and serves the built `.vanilla/` accordingly:

| Runtime  | How it serves                  |
| -------- | ------------------------------ |
| **ant**  | `ant .vanilla`                 |
| **bun**  | `bun .vanilla/index.js`        |
| **deno** | `deno serve .vanilla/index.js` |
| **node** | in-process `node:http` adapter |

Auto-detection prefers the runtime you launched with, then any of `ant`/`bun`/`deno` on your `PATH`, falling back to node. Force one with the `runtime` config field or `VANILLA_RUNTIME`:

```bash
VANILLA_RUNTIME=bun vanilla-bean start
```

## Project structure

```
src/
  pages/        file-based routes (+ layout.jsx, not-found.jsx)
  api/          HTTP endpoints + *.ws.js WebSocket routes
  actions/      "use server" RPC modules
  components/   shared components
  assets/       css and static assets
  layout.jsx    root layout
vanilla-bean.config.ts
```
