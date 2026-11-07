/**
 * Sequential function tables (`↑`, `↓`, `h`, `l`, previous-state outputs); the combinational
 * cases are in bench.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { defineComponent } from '../component';
import type { FunctionTable } from '../function-table';
import { Level, strong, toInput } from '../logic';
import { ns, us } from '../time';
import { Bench } from './bench';
import { functionTable } from './function-table';

/**
 * A negative-edge JK flip-flop with an active-low reset; J or K changing with the edge makes it
 * `X`. `broken` never toggles.
 */
function jk(broken = false) {
  return defineComponent<Record<string, never>, { q: Level }>({
    type: broken ? 'test/jk-broken' : 'test/jk',
    name: 'JK',
    title: 'Test JK flip-flop',
    pins: [
      { name: 'R', dir: 'in', activeLow: true },
      { name: 'CP', dir: 'in', clock: true },
      { name: 'J', dir: 'in' },
      { name: 'K', dir: 'in' },
      { name: 'Q', dir: 'out' },
      { name: 'QN', dir: 'out' },
    ],
    create: () => ({
      createState: () => ({ q: Level.X }),
      evaluate(ctx) {
        const j = toInput(ctx.read(2));
        const k = toInput(ctx.read(3));
        if (toInput(ctx.read(0)) === Level.L0) ctx.state.q = Level.L0;
        else if (ctx.fell(1) && (ctx.changed(2) || ctx.changed(3))) {
          ctx.state.q = Level.X; // J or K changed with the edge: a setup violation
        } else if (ctx.fell(1)) {
          const q = ctx.state.q;
          if (j === Level.L1 && k === Level.L1) ctx.state.q = broken ? q : q === Level.L1 ? 0 : 1;
          else if (j === Level.L1) ctx.state.q = Level.L1;
          else if (k === Level.L1) ctx.state.q = Level.L0;
        }
        const q = ctx.state.q;
        ctx.drive(4, strong(q), ns(2));
        ctx.drive(5, strong(q === Level.X ? q : q === Level.L1 ? 0 : 1), ns(2));
      },
    }),
  });
}

const TABLE: FunctionTable = {
  inputs: ['R', 'CP', 'J', 'K'],
  outputs: ['Q', 'QN'],
  rows: ['L X X X | L H', 'H ↓ h h | q̅ q', 'H ↓ l h | L H', 'H ↓ h l | H L', 'H ↓ l l | q q̅'],
  state: { q: 'Q' },
};

const STATES = [
  [{ R: 0 }, { R: 1 }],
  [{ R: 1, J: 1, K: 0, CP: 1 }, { CP: 0 }],
] as const;

describe('functionTable on sequential tables', () => {
  it('checks transitions and previous-state outputs from every given state', () => {
    const bench = new Bench(jk());
    // Reset row: 8 combinations; toggle and hold: 2 states each; load rows: 1 each.
    expect(functionTable(bench, TABLE, undefined, { states: STATES })).toBe(14);
    // Each step ran for the default gap of 1 µs.
    expect(bench.now).toBeGreaterThanOrEqual(us(14));
  });

  it('reports a row that fails from a state', () => {
    expect(() => functionTable(new Bench(jk(true)), TABLE, undefined, { states: STATES })).toThrow(
      /2 of 14 rows failed:\n {2}row "H ↓ h h \| q̅ q" from state #1 "/,
    );
  });

  it('needs states for previous-state rows, and states that load both levels', () => {
    expect(() => functionTable(new Bench(jk()), TABLE)).toThrow(
      'function table row "H ↓ h h | q̅ q" uses the previous state: pass options.states',
    );
    expect(() =>
      functionTable(new Bench(jk()), TABLE, undefined, { states: [STATES[0], STATES[0]] }),
    ).toThrow("function table: options.states don't load both 0 and 1 into Q");
  });

  it('applies the transition after the other inputs', () => {
    // J and K change from the previous state: set together with the edge, they'd make Q X.
    const loadOne: FunctionTable = { ...TABLE, rows: ['H ↓ H L | H L'] };
    const bench = new Bench(jk());
    bench.set({ R: 0, CP: 1, J: 0, K: 1 }).settle();
    expect(functionTable(bench, loadOne)).toBe(1);
  });

  it("sets a don't-care clock after the data, so its edges see stable data", () => {
    // Both states leave CP high and J = K = 1: with CP = L the row makes a falling edge while J
    // and K change; set together, the flip-flop would go X.
    const hold: FunctionTable = { ...TABLE, rows: ['H X l l | q q̅'] };
    const states = [
      [{ R: 0, CP: 1, J: 1, K: 1 }, { R: 1 }],
      [{ R: 1, J: 1, K: 0, CP: 1 }, { CP: 0 }, { CP: 1, K: 1 }],
    ] as const;
    expect(functionTable(new Bench(jk()), hold, undefined, { states })).toBe(4);
  });

  it('maps the columns to pins, previous-state references included', () => {
    const renamed: FunctionTable = { ...TABLE, outputs: ['nQ', 'nQN'], state: { q: 'nQ' } };
    expect(
      functionTable(new Bench(jk()), renamed, ['R', 'CP', 'J', 'K', 'Q', 'QN'], {
        states: STATES,
      }),
    ).toBe(14);
  });
});
