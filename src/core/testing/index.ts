/**
 * Test utilities for parts and circuits: single-part bench, datasheet function tables, traces.
 * Pure (no test framework imports): failures are thrown as plain errors. See docs/simulation.md#test-bench.
 */

export type { FunctionTable } from '../function-table';
export { testDriver } from '../test-driver';
export { Bench, type BenchValue, type BenchValues, toLevel } from './bench';
export {
  checkableRows,
  type FunctionTableOptions,
  functionTable,
  truthTable,
} from './function-table';
export { Trace } from './trace';
