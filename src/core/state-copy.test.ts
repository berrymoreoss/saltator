import { describe, expect, it } from 'vitest';
import { freezeState, STATE_PAGE_BYTES, stateBytes, thawState } from './state-copy';

function memoryLike(words: number) {
  return {
    data: new Uint8Array(words),
    readAt: new Float64Array(words).fill(Number.NEGATIVE_INFINITY),
    times: new Float64Array(5),
    gen: 0,
  };
}

describe('freezeState / thawState', () => {
  it('copies plain data that later changes do not reach', () => {
    const state = {
      q: 1,
      name: 'U1',
      on: true,
      big: 12n,
      none: null,
      missing: undefined,
      odd: [Number.NaN, -0, Number.NEGATIVE_INFINITY],
      nested: { list: [1, { deep: 'x' }], bits: new Uint8Array([1, 2, 3]) },
    };
    const frozen = freezeState(state);
    state.q = 2;
    state.odd[0] = 5;
    state.nested.list[0] = 9;
    state.nested.bits[1] = 7;
    const back = thawState(frozen, undefined);
    expect(back).toEqual({
      q: 1,
      name: 'U1',
      on: true,
      big: 12n,
      none: null,
      missing: undefined,
      odd: [Number.NaN, -0, Number.NEGATIVE_INFINITY],
      nested: { list: [1, { deep: 'x' }], bits: new Uint8Array([1, 2, 3]) },
    });
    expect(Object.is((back as typeof state).odd[1], -0)).toBe(true);
  });

  it('keeps primitives and states without an object as they are', () => {
    expect(thawState(freezeState(42), { old: 1 })).toBe(42);
    expect(thawState(freezeState(undefined), 3)).toBeUndefined();
    expect(thawState(freezeState('text'), undefined)).toBe('text');
  });

  it('thaws into the live objects, so views onto them stay valid', () => {
    const state = memoryLike(10_000);
    state.data[3] = 0x3f;
    const frozen = freezeState(state);
    const { data, readAt, times } = state;
    state.data[3] = 0;
    state.data[9_999] = 1;
    state.readAt[5] = 100;
    state.times[2] = 7;
    state.gen = 4;
    const back = thawState(frozen, state) as typeof state;
    expect(back).toBe(state);
    expect(back.data).toBe(data);
    expect(back.readAt).toBe(readAt);
    expect(back.times).toBe(times);
    expect(data[3]).toBe(0x3f);
    expect(data[9_999]).toBe(0);
    expect(readAt[5]).toBe(Number.NEGATIVE_INFINITY);
    expect(times[2]).toBe(0);
    expect(back.gen).toBe(0);
  });

  it('replaces what changed shape and drops keys the copy did not have', () => {
    const frozen = freezeState({ a: new Uint16Array([1, 2, 3]), b: { c: 1 }, list: [1, 2] });
    const live: Record<string, unknown> = {
      a: new Uint16Array(4), // another length
      b: 5, // not an object any more
      list: [1, 2, 3, 4],
      extra: 'gone',
    };
    const old = live.a;
    const back = thawState(frozen, live) as Record<string, unknown>;
    expect(back).toBe(live);
    expect(back.a).not.toBe(old);
    expect(back.a).toEqual(new Uint16Array([1, 2, 3]));
    expect(back.b).toEqual({ c: 1 });
    expect(back.list).toEqual([1, 2]);
    expect('extra' in back).toBe(false);
  });

  it('replaces a typed array of another type of the same length', () => {
    const frozen = freezeState({ a: new Int32Array([-1, 2]) });
    const live = { a: new Uint32Array(2) as Uint32Array | Int32Array };
    const back = thawState(frozen, live) as { a: Int32Array };
    expect(back.a).toBeInstanceOf(Int32Array);
    expect([...back.a]).toEqual([-1, 2]);
  });

  it('shares the pages that did not change with its base', () => {
    const words = 32_768;
    const state = memoryLike(words);
    const first = freezeState(state);
    state.readAt[100] = 5; // one page of readAt changes
    const second = freezeState(state, first);
    const pagesOf = (f: unknown, key: 'data' | 'readAt') => {
      const node = f as { keys: string[]; values: { pages: Uint8Array[] }[] };
      return node.values[node.keys.indexOf(key)]!.pages;
    };
    const readPages = pagesOf(second, 'readAt');
    expect(readPages.length).toBe((words * 8) / STATE_PAGE_BYTES);
    expect(readPages[0]).not.toBe(pagesOf(first, 'readAt')[0]);
    expect(readPages[1]).toBe(pagesOf(first, 'readAt')[1]);
    expect(pagesOf(second, 'data').every((p, i) => p === pagesOf(first, 'data')[i])).toBe(true);

    const all = stateBytes(second);
    const own = stateBytes(second, first);
    expect(all).toBeGreaterThan(words * 9);
    expect(own).toBeGreaterThanOrEqual(STATE_PAGE_BYTES);
    expect(own).toBeLessThan(2 * STATE_PAGE_BYTES);
    // Thawing either copy gives its own contents.
    expect((thawState(first, state) as typeof state).readAt[100]).toBe(Number.NEGATIVE_INFINITY);
    expect((thawState(second, state) as typeof state).readAt[100]).toBe(5);
  });

  it('compares bytes exactly: NaN equals itself, -0 differs from 0, odd lengths work', () => {
    const state = { f: new Float64Array([Number.NaN, 0]), b: new Uint8Array(4_097) };
    const first = freezeState(state);
    const same = freezeState(state, first) as unknown as { values: { pages: Uint8Array[] }[] };
    const firstPages = (first as unknown as { values: { pages: Uint8Array[] }[] }).values;
    expect(same.values[0]!.pages[0]).toBe(firstPages[0]!.pages[0]);
    expect(same.values[1]!.pages[1]).toBe(firstPages[1]!.pages[1]);
    state.f[1] = -0;
    state.b[4_096] = 1;
    const changed = freezeState(state, first) as unknown as { values: { pages: Uint8Array[] }[] };
    expect(changed.values[0]!.pages[0]).not.toBe(firstPages[0]!.pages[0]);
    expect(changed.values[1]!.pages[0]).toBe(firstPages[1]!.pages[0]);
    expect(changed.values[1]!.pages[1]).not.toBe(firstPages[1]!.pages[1]);
  });

  it('shares equal pages with a base of another length, not the shorter last one', () => {
    const first = freezeState({ a: new Uint8Array(STATE_PAGE_BYTES + 8) });
    const longer = freezeState({ a: new Uint8Array(STATE_PAGE_BYTES + 9) }, first);
    expect(stateBytes(longer, first)).toBe(stateBytes(longer) - STATE_PAGE_BYTES);
  });

  it('refuses what is not plain data, naming where', () => {
    expect(() => freezeState({ m: new Map() })).toThrow(/state\.m: a Map/);
    expect(() => freezeState({ s: [new Set()] })).toThrow(/state\.s\[0\]: a Set/);
    expect(() => freezeState({ f: () => 1 })).toThrow(/state\.f: a function/);
    expect(() => freezeState({ d: new Date(0) })).toThrow(/a Date/);
    class Thing {}
    expect(() => freezeState(new Thing(), undefined, 'U1')).toThrow(/^U1: a Thing/);
    expect(() => freezeState({ v: new DataView(new ArrayBuffer(4)) })).toThrow(/a DataView/);
    const shared = new Uint8Array(2);
    expect(() => freezeState({ a: shared, b: shared })).toThrow(/state\.b: reached twice/);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => freezeState(loop)).toThrow(/reached twice/);
  });

  it('takes objects without a prototype', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    expect(thawState(freezeState(bare), undefined)).toEqual({ a: 1 });
  });
});
