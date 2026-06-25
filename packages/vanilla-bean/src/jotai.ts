import { signal, onCleanup, type Signal } from "vanilla-bean";
import { getDefaultStore, type Atom, type WritableAtom } from "jotai/vanilla";

type Store = ReturnType<typeof getDefaultStore>;

export function useAtomValue<T>(atom: Atom<T>, store: Store = getDefaultStore()): Signal<T> {
  const value = signal(store.get(atom)) as unknown as Signal<T>;
  if (!import.meta.env?.SSR) onCleanup(store.sub(atom, () => value(store.get(atom))));
  return value;
}

export function useSetAtom<A extends unknown[], R>(
  atom: WritableAtom<unknown, A, R>,
  store: Store = getDefaultStore(),
): (...args: A) => R {
  return (...args: A) => store.set(atom, ...args);
}

export function useAtom<T, A extends unknown[], R>(
  atom: WritableAtom<T, A, R>,
  store: Store = getDefaultStore(),
): [Signal<T>, (...args: A) => R] {
  return [useAtomValue(atom, store), useSetAtom(atom, store)];
}
