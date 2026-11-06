import { describe, expect, it } from 'vitest';
import { Store } from './store';

describe('Store', () => {
  it('notifies subscribers of changes only', () => {
    const store = new Store(1);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.set(1);
    expect(calls).toBe(0);
    store.set(2);
    store.update((n) => n + 1);
    expect(store.get()).toBe(3);
    expect(calls).toBe(2);
    unsubscribe();
    store.set(4);
    expect(calls).toBe(2);
  });
});
