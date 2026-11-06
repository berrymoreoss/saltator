import { useSyncExternalStore } from 'react';
import type { Store } from '../editor';

/** The current value of a store; re-renders when it changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/**
 * A value derived from a store; re-renders only when the derived value changes (compared with
 * `Object.is`, so derive primitives).
 */
export function useStoreValue<T, V>(store: Store<T>, select: (value: T) => V): V {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const list = matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
}

/** Whether a CSS media query matches, live. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(subscribeMedia(query), () => matchMedia(query).matches);
}
