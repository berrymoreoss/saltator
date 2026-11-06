/** Shared helpers for kernel scenario tests (not a test file itself). */
import {
  type Diagnostic,
  levelChar,
  NetlistBuilder,
  Simulator,
  type SimulatorOptions,
  strong,
} from '../../src/core';
import { type BenchValue, testDriver, toLevel } from '../../src/core/testing';
import { createDefaultRegistry } from '../../src/library';

/** Built-in parts plus `test/driver` (an externally set tri-state source). */
export function scenarioRegistry() {
  return createDefaultRegistry().register(testDriver);
}

export function simulate(
  build: (b: NetlistBuilder) => NetlistBuilder,
  options?: SimulatorOptions,
): Simulator {
  return new Simulator(build(new NetlistBuilder()).build(), scenarioRegistry(), options);
}

/** Sets a `test/driver` instance to a value at the current time. */
export function set(sim: Simulator, driver: string, value: BenchValue): void {
  sim.action(driver, strong(toLevel(value)));
}

/** Levels of nets as a compact string, e.g. `levels(sim, 'Q', 'QN')` → `'10'`. */
export function levels(sim: Simulator, ...nets: string[]): string {
  return nets.map((n) => levelChar(sim.level(n))).join('');
}

export function kinds(sim: Simulator): string[] {
  return sim.diagnostics.entries.map((d: Diagnostic) => d.kind);
}
