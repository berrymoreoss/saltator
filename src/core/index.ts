/**
 * Public API of the simulation kernel (signal model, scheduler, netlist runtime, component API).
 * Spec: docs/simulation.md.
 */

export {
  and,
  DRIVES,
  Drive,
  driveName,
  isContention,
  LEVELS,
  Level,
  levelChar,
  levelOf,
  not,
  or,
  resolve,
  Strength,
  strengthOf,
  strong,
  toInput,
  weak,
  xor,
} from './logic';
export { formatTime, ms, ns, ps, TIME_MAX, type Time, us } from './time';
