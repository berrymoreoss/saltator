/**
 * Frozen copies of component states, for simulator snapshots (R14b): plain data — objects,
 * arrays, primitives and typed arrays — copied so later changes don't reach them. Typed arrays
 * are kept in pages of `STATE_PAGE_BYTES`, and a copy made against a `base` (the copy before
 * it) shares every page that is still equal, so a memory's cells and access stamps cost nothing
 * while they don't change. Thawing writes back into the live objects where the shape is the
 * same, so views onto them stay valid. Spec: docs/simulation.md#snapshots.
 */

/** Size of a typed array page in a frozen state. */
export const STATE_PAGE_BYTES = 4096;

const TYPED = {
  Uint8Array,
  Uint8ClampedArray,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
} as const;

type TypedName = keyof typeof TYPED;
type TypedArray = InstanceType<(typeof TYPED)[TypedName]>;
type Primitive = string | number | boolean | bigint | null | undefined;

interface FrozenArray {
  readonly kind: 'array';
  readonly items: readonly FrozenState[];
}

interface FrozenObject {
  readonly kind: 'object';
  readonly keys: readonly string[];
  readonly values: readonly FrozenState[];
}

interface FrozenTyped {
  readonly kind: 'typed';
  readonly type: TypedName;
  readonly length: number;
  /** The array's bytes, `STATE_PAGE_BYTES` each (the last one shorter). */
  readonly pages: readonly Uint8Array[];
}

/** A frozen copy of a state (`freezeState`); treat it as opaque. */
export type FrozenState = Primitive | FrozenArray | FrozenObject | FrozenTyped;

/** Bytes counted for each object, array or typed array of a frozen state, besides its pages. */
const NODE_BYTES = 48;

/**
 * A copy of `value` that later changes to it don't reach. With `base` (an earlier copy of the
 * same state) its typed array pages that are still equal are shared, not copied. Throws for
 * anything that isn't plain data — a `Map`, a function, a class instance, an object reached
 * twice — naming where (`path`): a component state must be plain data.
 */
export function freezeState(value: unknown, base?: FrozenState, path = 'state'): FrozenState {
  return freeze(value, base, path, new WeakSet());
}

function freeze(
  value: unknown,
  base: FrozenState,
  path: string,
  seen: WeakSet<object>,
): FrozenState {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return value;
    case 'function':
    case 'symbol':
      throw new Error(`${path}: a ${typeof value} can't be part of a snapshot`);
  }
  if (value === null) return null;
  const object = value as object;
  if (seen.has(object)) throw new Error(`${path}: reached twice (shared or circular data)`);
  seen.add(object);
  if (ArrayBuffer.isView(object)) return freezeTyped(object, base, path);
  if (Array.isArray(object)) {
    const items = base !== null && typeof base === 'object' && base.kind === 'array' && base.items;
    return {
      kind: 'array',
      items: object.map((item, i) =>
        freeze(item, items ? items[i] : undefined, `${path}[${i}]`, seen),
      ),
    };
  }
  const proto: unknown = Object.getPrototypeOf(object);
  if (proto !== Object.prototype && proto !== null) {
    const name = (object as { constructor?: { name?: string } }).constructor?.name ?? 'object';
    throw new Error(`${path}: a ${name} can't be part of a snapshot (plain data only)`);
  }
  const record = object as Record<string, unknown>;
  const keys = Object.keys(record);
  const old =
    base !== null && typeof base === 'object' && base.kind === 'object' ? base : undefined;
  const values = keys.map((key, i) => {
    const previous = old ? old.values[old.keys[i] === key ? i : old.keys.indexOf(key)] : undefined;
    return freeze(record[key], previous, `${path}.${key}`, seen);
  });
  return { kind: 'object', keys, values };
}

function freezeTyped(view: ArrayBufferView, base: FrozenState, path: string): FrozenTyped {
  const type = typedName(view);
  if (type === undefined) {
    throw new Error(`${path}: a ${view.constructor.name} can't be part of a snapshot`);
  }
  const length = (view as TypedArray).length;
  // Pages are bytes: an equal one is shared whatever the array was (a resized one shares too).
  const shared =
    base !== null && typeof base === 'object' && base.kind === 'typed' ? base.pages : undefined;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const pages: Uint8Array[] = [];
  for (let offset = 0, i = 0; offset < bytes.length; offset += STATE_PAGE_BYTES, i++) {
    const page = bytes.subarray(offset, offset + STATE_PAGE_BYTES);
    const old = shared?.[i];
    pages.push(old !== undefined && sameBytes(old, page) ? old : page.slice());
  }
  return { kind: 'typed', type, length, pages };
}

function typedName(view: ArrayBufferView): TypedName | undefined {
  const name = view.constructor.name;
  return Object.hasOwn(TYPED, name) && TYPED[name as TypedName] === view.constructor
    ? (name as TypedName)
    : undefined;
}

/** Byte-wise equality, four bytes at a time where both are aligned. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  const n = a.length;
  if (n !== b.length) return false;
  if (n % 4 === 0 && a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
    const x = new Int32Array(a.buffer, a.byteOffset, n / 4);
    const y = new Int32Array(b.buffer, b.byteOffset, n / 4);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The state `frozen` was taken from, written into `target` (the live state) where its shape is
 * the same — the same objects, arrays and typed arrays, so views onto them stay valid — and
 * new where it isn't. Returns what the state is now (`target` itself unless its shape changed).
 */
export function thawState(frozen: FrozenState, target: unknown): unknown {
  if (frozen === null || typeof frozen !== 'object') return frozen;
  switch (frozen.kind) {
    case 'typed':
      return thawTyped(frozen, target);
    case 'array': {
      const array = Array.isArray(target) ? (target as unknown[]) : [];
      array.length = frozen.items.length;
      frozen.items.forEach((item, i) => {
        const next = thawState(item, array[i]);
        if (next !== array[i] || !(i in array)) array[i] = next;
      });
      return array;
    }
    case 'object': {
      const record = isPlainObject(target) ? target : {};
      const keep = new Set(frozen.keys);
      for (const key of Object.keys(record)) if (!keep.has(key)) delete record[key];
      frozen.keys.forEach((key, i) => {
        const next = thawState(frozen.values[i], record[key]);
        if (next !== record[key] || !(key in record)) record[key] = next;
      });
      return record;
    }
  }
}

function thawTyped(frozen: FrozenTyped, target: unknown): TypedArray {
  const ctor = TYPED[frozen.type];
  const array =
    target instanceof ctor && target.length === frozen.length
      ? (target as TypedArray)
      : new ctor(frozen.length);
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  frozen.pages.forEach((page, i) => {
    bytes.set(page, i * STATE_PAGE_BYTES);
  });
  return array;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (ArrayBuffer.isView(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Approximate memory a frozen state holds that `relativeTo` (another copy of the same state,
 * usually the one it was made against) doesn't share with it: its pages not found there, plus a
 * little for each node. Without `relativeTo`, all of it.
 */
export function stateBytes(frozen: FrozenState, relativeTo?: FrozenState): number {
  if (frozen === null || typeof frozen !== 'object') return 8;
  const other = relativeTo !== null && typeof relativeTo === 'object' ? relativeTo : undefined;
  switch (frozen.kind) {
    case 'typed': {
      const pages = other?.kind === 'typed' ? other.pages : undefined;
      let bytes = NODE_BYTES;
      frozen.pages.forEach((page, i) => {
        if (pages?.[i] !== page) bytes += page.length;
      });
      return bytes;
    }
    case 'array': {
      const items = other?.kind === 'array' ? other.items : undefined;
      let bytes = NODE_BYTES;
      frozen.items.forEach((item, i) => {
        bytes += stateBytes(item, items?.[i]);
      });
      return bytes;
    }
    case 'object': {
      const keys = other?.kind === 'object' ? other : undefined;
      let bytes = NODE_BYTES;
      frozen.keys.forEach((key, i) => {
        const j = keys ? (keys.keys[i] === key ? i : keys.keys.indexOf(key)) : -1;
        bytes += stateBytes(frozen.values[i], j >= 0 ? keys?.values[j] : undefined);
      });
      return bytes;
    }
  }
}
