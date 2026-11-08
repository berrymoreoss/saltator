/**
 * Parts for the test bench's unit tests: inputs operated as the library's are (by symbol kind:
 * a switch, a button, a DIP switch, a clock), a D flip-flop that reports a set-up violation and
 * a RAM taking `poke`. Not part of the public API; real parts are tried in tests/scenarios.
 */
import {
  createAccessStamps,
  defineComponent,
  type EvalContext,
  isPokeAction,
  Level,
  ns,
  type PinDef,
  Registry,
  strong,
} from '../../core';
import { testAnd, testHigh, testLabel, testPort, testRom } from '../test-parts';

const one = (on: boolean) => strong(on ? Level.L1 : Level.L0);
const actionType = (payload: unknown) => (payload as { type?: unknown } | null)?.type;

/** `test/switch`: `Y` is 1 while on; actions `{ type: 'set', on }`, `{ type: 'toggle' }`. */
export const testSwitch = defineComponent<{ on: boolean }, { on: boolean }>({
  type: 'test/switch',
  name: 'SW',
  title: 'Test switch',
  designatorPrefix: 'SW',
  props: [{ key: 'on', label: 'On', type: 'boolean', default: false }],
  pins: [{ name: 'Y', dir: 'out' }],
  symbol: { kind: 'switch', width: 2, height: 2, pins: { Y: { side: 'right', offset: 1 } } },
  create: ({ on }) => ({
    createState: () => ({ on }),
    init: (ctx) => ctx.drive(0, one(ctx.state.on), 0),
    action(ctx, payload) {
      const action = payload as { type: string; on?: boolean };
      if (action.type === 'toggle') ctx.state.on = !ctx.state.on;
      else if (action.type === 'set' && typeof action.on === 'boolean') ctx.state.on = action.on;
      else throw new Error(`${ctx.id}: bad action`);
      ctx.drive(0, one(ctx.state.on), 0);
    },
  }),
});

/** `test/button`: `Y` is 1 while pressed; actions `press`, `release`. */
export const testButton = defineComponent<Record<string, never>, undefined>({
  type: 'test/button',
  name: 'BTN',
  title: 'Test button',
  designatorPrefix: 'SW',
  pins: [{ name: 'Y', dir: 'out' }],
  symbol: { kind: 'button', width: 2, height: 2, pins: { Y: { side: 'right', offset: 1 } } },
  create: () => ({
    init: (ctx) => ctx.drive(0, one(false), 0),
    action(ctx, payload) {
      const type = actionType(payload);
      if (type !== 'press' && type !== 'release') throw new Error(`${ctx.id}: bad action`);
      ctx.drive(0, one(type === 'press'), 0);
    },
  }),
});

/** `test/dips`: `count` switches, `Y0`…; action `{ type: 'set', index, on }`. */
export const testDips = defineComponent<{ count: number }, { on: boolean[] }>({
  type: 'test/dips',
  name: 'DIP',
  title: 'Test DIP switch',
  designatorPrefix: 'SW',
  props: [{ key: 'count', label: 'Switches', type: 'integer', default: 4, min: 1, max: 8 }],
  pins: ({ count }) =>
    Array.from({ length: count }, (_, i): PinDef => ({ name: `Y${i}`, dir: 'out' })),
  symbol: ({ count }) => ({
    kind: 'dip-switch',
    width: 2,
    height: count + 1,
    pins: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`Y${i}`, { side: 'right', offset: i + 1 }]),
    ),
  }),
  create: ({ count }) => ({
    createState: () => ({ on: Array.from({ length: count }, () => false) }),
    init: (ctx) => {
      for (let i = 0; i < count; i++) ctx.drive(i, one(false), 0);
    },
    action(ctx, payload) {
      const { type, index, on } = payload as { type: string; index: number; on: boolean };
      if (type !== 'set' || !(index >= 0 && index < count))
        throw new Error(`${ctx.id}: bad action`);
      ctx.state.on[index] = on;
      ctx.drive(index, one(on), 0);
    },
  }),
});

/**
 * `test/clock`: `Y` toggles every 500 ns from 0 in `auto` mode; in `manual` mode it stays 0 and
 * each `step` makes a 100 ns pulse.
 */
export const testClock = defineComponent<{ mode: 'auto' | 'manual' }, { high: boolean }>({
  type: 'test/clock',
  name: 'CLK',
  title: 'Test clock',
  designatorPrefix: 'X',
  props: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'enum',
      default: 'manual',
      options: [
        { value: 'auto', label: 'auto' },
        { value: 'manual', label: 'manual' },
      ],
    },
  ],
  pins: [{ name: 'Y', dir: 'out' }],
  symbol: { kind: 'clock', width: 2, height: 2, pins: { Y: { side: 'right', offset: 1 } } },
  create: ({ mode }) => ({
    createState: () => ({ high: false }),
    init: (ctx) => {
      ctx.drive(0, one(false), 0);
      if (mode === 'auto') ctx.wakeAfter(ns(500));
    },
    wake(ctx, token) {
      if (mode === 'auto') {
        ctx.state.high = !ctx.state.high;
        ctx.drive(0, one(ctx.state.high), 0);
        ctx.wakeAfter(ns(500));
      } else if (token === 1) {
        ctx.drive(0, one(false), 0);
      }
    },
    action(ctx, payload) {
      if (actionType(payload) !== 'step') throw new Error(`${ctx.id}: bad action`);
      if (mode !== 'manual') return;
      ctx.drive(0, one(true), 0);
      ctx.wakeAfter(ns(100), 1);
    },
  }),
});

/**
 * `test/dff`: `Q` takes `D` 2 ns after `CLK` rises; `D` changing less than 10 ns before the edge
 * is a `setup-violation` and makes `Q` unknown.
 */
export const testDff = defineComponent<Record<string, never>, { changed: number }>({
  type: 'test/dff',
  name: 'DFF',
  title: 'Test D flip-flop',
  pins: [
    { name: 'D', dir: 'in' },
    { name: 'CLK', dir: 'in' },
    { name: 'Q', dir: 'out' },
  ],
  create: () => ({
    createState: () => ({ changed: -Infinity }),
    evaluate(ctx) {
      if (ctx.changed(0)) ctx.state.changed = ctx.now;
      if (!ctx.rose(1)) return;
      if (ctx.now - ctx.state.changed < ns(10)) {
        ctx.report({ kind: 'setup-violation', message: 'D changed less than 10 ns before CLK' });
        ctx.drive(2, strong(Level.X), ns(2));
        return;
      }
      ctx.drive(2, strong(ctx.read(0)), ns(2));
    },
  }),
});

interface RamState {
  readonly data: Uint8Array;
  readonly unknown: Uint8Array;
  readonly stamps: ReturnType<typeof createAccessStamps>;
}

/** `test/ram`: 16 bytes; reads `A0`–`A3` onto `D0`–`D7` after 5 ns; only `poke` writes. */
export const testRam = defineComponent<Record<string, never>, RamState>({
  type: 'test/ram',
  name: 'RAM',
  title: 'Test RAM',
  pins: [
    ...[0, 1, 2, 3].map((i): PinDef => ({ name: `A${i}`, dir: 'in' })),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): PinDef => ({ name: `D${i}`, dir: 'out' })),
  ],
  memory: {
    words: 16,
    width: 8,
    volatile: true,
    addressPins: ['A0', 'A1', 'A2', 'A3'],
    view: (state) => ({ data: state.data, unknown: state.unknown, ...state.stamps }),
  },
  create: () => {
    const output = (ctx: EvalContext<RamState>) => {
      let address = 0;
      for (let i = 0; i < 4; i++) {
        const level = ctx.read(i);
        if (level !== Level.L0 && level !== Level.L1) {
          for (let b = 0; b < 8; b++) ctx.drive(4 + b, strong(Level.X), ns(5));
          return;
        }
        address |= level << i;
      }
      const data = ctx.state.data[address]!;
      const unknown = ctx.state.unknown[address]!;
      for (let b = 0; b < 8; b++) {
        const level = (unknown >> b) & 1 ? Level.X : (((data >> b) & 1) as Level);
        ctx.drive(4 + b, strong(level), ns(5));
      }
    };
    return {
      createState: () => ({
        data: new Uint8Array(16),
        unknown: new Uint8Array(16).fill(0xff),
        stamps: createAccessStamps(16),
      }),
      evaluate: output,
      action(ctx, payload) {
        if (!isPokeAction(payload)) throw new Error(`${ctx.id}: bad action`);
        payload.data.forEach((byte, i) => {
          ctx.state.data[payload.address + i] = byte;
          ctx.state.unknown[payload.address + i] = 0;
        });
        output(ctx);
      },
    };
  },
});

/** The circuit test parts with the bench's. */
export function benchTestRegistry(): Registry {
  return new Registry([
    testAnd,
    testHigh,
    testLabel,
    testPort,
    testRom,
    testSwitch,
    testButton,
    testDips,
    testClock,
    testDff,
    testRam,
  ]);
}
