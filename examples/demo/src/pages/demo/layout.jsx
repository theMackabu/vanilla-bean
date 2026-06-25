import { cn } from "cnfast";

import Time from "../../components/Time.jsx";
import BuildStamp from "../../components/BuildStamp.jsx";

const links = [
  { href: "/demo/counter", label: "counter" },
  { href: "/demo/fetch", label: "fetch" },
  { href: "/demo/list", label: "list" },
  { href: "/demo/static", label: "static" },
  { href: "/demo/action", label: "action" },
  { href: "/demo/api", label: "api" },
  { href: "/demo/ws", label: "ws" },
  { href: "/demo/rsc", label: "use server" },
  { href: "/demo/jotai", label: "jotai" },
  { href: "/demo/auth", label: "auth" },
  { href: "/demo/boom", label: "boom" },
];

const Link = ({ href, label }) => (
  <a
    href={href}
    class={cn("hover:underline", "text-zinc-600 hover:text-zinc-900", "dark:text-zinc-400 dark:hover:text-zinc-100")}
  >
    {label}
  </a>
);

export default ({ children }) => (
  <section>
    <nav class="flex gap-4 border-b border-white/10 px-2 py-1 text-sm">{links.map(Link)}</nav>
    <div class="p-2">{children}</div>
    <div class="absolute bottom-2 right-4 text-xs opacity-60">
      mounted (client) at <Time /> with <BuildStamp />
    </div>
  </section>
);
