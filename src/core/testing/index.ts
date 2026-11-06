/**
 * Test utilities for parts and circuits: single-part bench, datasheet function tables, traces.
 * Pure (no test framework imports): failures are thrown as plain errors. See docs/simulation.md#test-bench.
 */
export { Bench, type BenchValue, type BenchValues, testDriver, toLevel } from './bench';
export { type FunctionTable, functionTable, truthTable } from './function-table';
export { Trace } from './trace';
