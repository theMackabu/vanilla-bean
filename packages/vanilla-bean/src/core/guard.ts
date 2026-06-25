let rendering = false;

export function setRendering(value: boolean): void {
  rendering = value;
}

export function installTimerGuard(mode: "error" | "warn"): void {
  const g = globalThis as any;
  if (g.__vbTimerGuard) return;
  g.__vbTimerGuard = true;

  for (const name of ["setInterval", "requestAnimationFrame"] as const) {
    const real = g[name];
    if (typeof real !== "function") continue;
    g[name] = (...args: unknown[]): unknown => {
      if (rendering) {
        const msg =
          `[vanilla-bean] ${name}() ran during a server render. Timers leak on the server ` +
          `(they tick against a discarded document) — move this into a "use client" component.`;
        if (mode === "error") throw new Error(msg);
        console.warn(msg);
        return 0;
      }
      return real(...args);
    };
  }
}
