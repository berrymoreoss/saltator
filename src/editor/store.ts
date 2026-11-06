/**
 * A minimal observable value: what React's `useSyncExternalStore` needs (`subscribe`, `get` as
 * the snapshot) and nothing more. Setting an identical value notifies no one.
 */
export class Store<T> {
  #value: T;
  readonly #listeners = new Set<() => void>();

  constructor(value: T) {
    this.#value = value;
  }

  /** The current value (stable between changes, as `useSyncExternalStore` requires). */
  get = (): T => this.#value;

  set(value: T): void {
    if (Object.is(value, this.#value)) return;
    this.#value = value;
    for (const listener of [...this.#listeners]) listener();
  }

  update(change: (value: T) => T): void {
    this.set(change(this.#value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
}
