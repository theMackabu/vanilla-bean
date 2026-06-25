import { signal, onCleanup } from "vanilla-bean";

export default function Time() {
  "use client";
  const now = signal(new Date().toLocaleTimeString());
  const id = setInterval(() => now(new Date().toLocaleTimeString()), 1000);
  onCleanup(() => clearInterval(id));
  return <strong>{now}</strong>;
}

Time.fallback = () => <strong class="invisible">00:00:00 __</strong>;
