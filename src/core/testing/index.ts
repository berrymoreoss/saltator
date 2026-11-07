/**
 * Test utilities for parts and circuits: single-part bench, datasheet function tables, traces.
 * Pure (no test framework imports): failures are thrown as plain errors. See docs/simulation.md#test-bench.
 */

export type { FunctionTable } from '../function-table';
export { Bench, type BenchValue, type BenchValues, testDriver, toLevel } from './bench';
export {
  checkableRows,
  type FunctionTableOptions,
  functionTable,
  truthTable,
} from './function-table';
export { Trace } from './trace';
