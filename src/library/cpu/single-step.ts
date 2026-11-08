/**
 * Runs SingleStepTests 65x02 cases (github.com/SingleStepTests/65x02, `wdc65c02/v1`, MIT) on
 * the pure core: each case is one instruction from a known state in a 64 KB RAM, with every
 * cycle's address, data and direction and the state after it. Used by the committed sample
 * (`w65c02s-sst.test.ts`) and by `pnpm test:65c02` (`scripts/test-65c02.ts`), which runs every
 * case. Test-only code: no part uses it.
 */
import { createCore, endCycle, loadRegisters, Mode } from './w65c02s-core';

/** A processor state as the cases write it; `ram` is `[address, value]` pairs. */
export interface SingleStepState {
  readonly pc: number;
  readonly s: number;
  readonly a: number;
  readonly x: number;
  readonly y: number;
  readonly p: number;
  readonly ram: readonly (readonly [number, number])[];
}

/** One case: `cycles` are `[address, value, 'read' | 'write']`. */
export interface SingleStepCase {
  readonly name: string;
  readonly initial: SingleStepState;
  readonly final: SingleStepState;
  readonly cycles: readonly (readonly [number, number, string])[];
}

/**
 * Where the core follows the data sheet rather than the cases (each is documented in
 * docs/components.md#w65c02s):
 *
 * - `5C` takes 8 cycles (Table 7-1); the cases give it 4. Only its final state is compared.
 * - `ADC #`/`SBC #` in decimal mode: the extra cycle's address in the cases follows no rule
 *   (`$7F` for one opcode, `$0000` for the other); the core reads at PC there. That cycle's
 *   address and data are not compared.
 */
function exempt(opcode: number, test: SingleStepCase): { cycles: boolean; lastAddress: boolean } {
  if (opcode === 0x5c) return { cycles: false, lastAddress: false };
  const decimal = (test.initial.p & 0x08) !== 0;
  if ((opcode === 0x69 || opcode === 0xe9) && decimal) return { cycles: true, lastAddress: false };
  return { cycles: true, lastAddress: true };
}

const hex = (value: number, digits = 2) => value.toString(16).padStart(digits, '0');

/** Runs one case; returns what differs (empty: passed). */
export function runSingleStepCase(test: SingleStepCase): string[] {
  const problems: string[] = [];
  const ram = new Uint8Array(0x10000);
  for (const [address, value] of test.initial.ram) ram[address] = value;
  const core = createCore();
  loadRegisters(core, test.initial);
  const opcode = ram[test.initial.pc] ?? 0;
  const rules = exempt(opcode, test);
  const expected = test.cycles;
  const limit = rules.cycles ? expected.length : 64;
  for (let i = 0; i < limit; i++) {
    if (core.mode !== Mode.running) {
      problems.push(`cycle ${i}: the CPU is no longer running (mode ${core.mode})`);
      break;
    }
    if (i > 0 && core.sync) {
      if (rules.cycles) problems.push(`ended after ${i} cycles, expected ${expected.length}`);
      break;
    }
    const [address, value, kind] = expected[i] ?? [0, 0, 'read'];
    const actualKind = core.write ? 'write' : 'read';
    const data = core.write ? core.wdata : (ram[core.addr] ?? 0);
    const checkAddress = rules.lastAddress || i < expected.length - 1;
    if (rules.cycles && (actualKind !== kind || (checkAddress && core.addr !== address))) {
      problems.push(
        `cycle ${i}: ${actualKind} ${hex(core.addr, 4)}, expected ${kind} ${hex(address, 4)}`,
      );
      break;
    }
    if (rules.cycles && checkAddress && data !== value) {
      problems.push(`cycle ${i}: data ${hex(data)}, expected ${hex(value)}`);
      break;
    }
    if (core.uaddr !== 0 || core.uwdata !== 0) {
      problems.push(`cycle ${i}: unknown bits on the bus`);
      break;
    }
    if (core.write) ram[core.addr] = core.wdata;
    endCycle(core, data, 0);
  }
  if (problems.length === 0 && (core.mode !== Mode.running || core.sync !== 1)) {
    problems.push(`not at an opcode fetch after ${limit} cycles`);
  }
  const f = test.final;
  const registers: [string, number, number, number][] = [
    ['pc', core.pc, core.upc, f.pc],
    ['s', core.s, core.us, f.s],
    ['a', core.a, core.ua, f.a],
    ['x', core.x, core.ux, f.x],
    ['y', core.y, core.uy, f.y],
    ['p', core.p, core.up, f.p],
  ];
  for (const [name, value, unknown, want] of registers) {
    // P's bits 4 (B) and 5 aren't flip-flops: the cases keep whatever they were given.
    const mask = name === 'p' ? 0xcf : 0xffff;
    if (unknown !== 0) problems.push(`${name} has unknown bits ${hex(unknown)}`);
    else if ((value & mask) !== (want & mask)) {
      problems.push(`${name} = ${hex(value)}, expected ${hex(want)}`);
    }
  }
  for (const [address, value] of f.ram) {
    if (ram[address] !== value) {
      problems.push(`ram[${hex(address, 4)}] = ${hex(ram[address] ?? 0)}, expected ${hex(value)}`);
    }
  }
  return problems;
}
