import { useSyncExternalStore } from 'react';

/*
 * A one-value store for state that changes per pointer move (the cursor's distance along the
 * straight, the current reading). Only the components that show it subscribe, so moving the
 * cursor re-renders the instrument and the readout, never the whole page.
 */
export interface Store<T> {
  get: () => T;
  set: (v: T) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      if (Object.is(v, value)) return;
      value = v;
      subs.forEach((f) => f());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T>(s: Store<T>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
