import "./assets/index.css";

import { cn } from "cnfast";
import pkg from "../package.json";
import { signal, onCleanup, useLocation, Head } from "vanilla-bean";

function Clock() {
  "use client";

  const seconds = signal(0);
  const id = setInterval(() => seconds++, 1000);
  onCleanup(() => clearInterval(id));

  return (
    <span class="tabular-nums">
      uptime <span class="inline-block text-right min-w-[1ch]">{seconds}</span>s
    </span>
  );
}

function Link({ to, children }) {
  const { path } = useLocation();

  const styles = {
    root: "hover:underline",
    active: "text-white underline",
    default: "text-zinc-400",
  };

  const active = (active) => {
    const seg = (s) => s.split("/").filter(Boolean)[0] ?? "";
    if (seg(path) === seg(active)) return styles.active;
    return styles.default;
  };

  return (
    <a href={to} class={cn(styles.root, active(to))}>
      {children}
    </a>
  );
}

export default function Layout({ children }) {
  return (
    <Fragment>
      <Head>
        <title>vanilla bean</title>
        <meta name="app-version" content={pkg.version} />
      </Head>
      <nav class="bg-zinc-200 dark:bg-zinc-900 text-white py-2 px-4 flex justify-between">
        <div class="flex items-center gap-x-3">
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/demo/counter">Demos</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/users/1">Users</Link>
        </div>
        <div class="flex items-center gap-x-3">
          <input class="outline-none" placeholder="search..." />
          <Clock />
        </div>
      </nav>
      <main class="px-4 py-3">{children}</main>
    </Fragment>
  );
}
