/**
 * A module's `specify` block from Yosys's JSON (HDL-2): `read_verilog -specify` makes its paths
 * `$specify2` (simple, conditional) and `$specify3` (edge-sensitive) cells and its timing checks
 * `$specrule` cells. Here they become the IR's paths and checks: times from nanoseconds to
 * picoseconds, the checks normalized (a `$setuphold` is a set-up and a hold, a `$hold` between
 * opposite edges of one pin a pulse width — Yosys reads no `$width` — and between one pin's same
 * edges a cycle time — nor `$period`), and what the simulator doesn't model dropped with a
 * warning. Spec: docs/components.md#verilog-modules-hdl.
 */
import type {
  HdlBit,
  HdlCheck,
  HdlCheckEvent,
  HdlDelay,
  HdlPath,
  HdlPort,
  HdlSpecify,
} from '../../core';

/** The cell types a `specify` block gives. */
export const SPECIFY_CELLS: ReadonlySet<string> = new Set(['$specify2', '$specify3', '$specrule']);

/** Reads a cell port's bits (renumbered as every other cell's). */
export type ReadBits = (port: string) => HdlBit[];

/** Reports a warning at the cell's source location. */
export type Warn = (message: string) => void;

/** What the simulator checks; the other rules Yosys reads are dropped. */
const UNCHECKED: Readonly<Record<string, string>> = {
  $skew: 'a $skew check',
  $timeskew: 'a $timeskew check',
  $fullskew: 'a $fullskew check',
  $nochange: 'a $nochange check',
  $period: 'a $period check',
  $width: 'a $width check',
};

const CHECKED =
  'the simulator checks set-up, hold, recovery, removal, pulse widths and cycle times';

/** A Yosys constant (a binary string, most significant first) as a number. */
function flag(value: unknown): number | undefined {
  return typeof value === 'string' && /^[01]+$/.test(value) ? Number.parseInt(value, 2) : undefined;
}

/**
 * A time parameter, written in nanoseconds, in picoseconds: a 32-bit binary string (two's
 * complement), a number (`write_json -compat-int`), or a decimal Yosys keeps as a string
 * (`"9.500000"`). Undefined when it is none of these.
 */
export function picoseconds(value: unknown): number | undefined {
  let ns: number | undefined;
  if (typeof value === 'number') ns = value;
  else if (typeof value === 'string' && value.includes('.')) {
    ns = /^-?\d+\.\d*$/.test(value) ? Number(value) : undefined;
  } else if (typeof value === 'string' && /^[01]+$/.test(value)) {
    const n = Number.parseInt(value, 2);
    ns = value.length === 32 && value[0] === '1' ? n - 2 ** 32 : n;
  }
  return ns === undefined || !Number.isFinite(ns) ? undefined : Math.round(ns * 1000);
}

/** An edge from a rule's or path's "edge given" and "posedge" flags. */
function edgeOf(enabled: unknown, positive: unknown): 'rise' | 'fall' | undefined {
  if (flag(enabled) !== 1) return undefined;
  return flag(positive) === 1 ? 'rise' : 'fall';
}

/** A condition bit: none for `1` (always), the bit otherwise. */
function whenOf(bits: readonly HdlBit[]): { when?: HdlBit } {
  const bit = bits[0];
  return bit === undefined || bit === '1' ? {} : { when: bit };
}

/**
 * The paths and checks of one `specify` cell, its bits as read (not yet checked against the
 * ports: `placeSpecify` does that). Problems with its parameters are warnings and drop it.
 */
export function readSpecifyCell(
  type: string,
  parameters: Readonly<Record<string, unknown>>,
  bits: ReadBits,
  src: string,
  warn: Warn,
): HdlSpecify {
  const none: HdlSpecify = { paths: [], checks: [] };
  if (type === '$specify2' || type === '$specify3') {
    const corners = (edge: 'RISE' | 'FALL'): HdlDelay | undefined => {
      const [min, typ, max] = (['MIN', 'TYP', 'MAX'] as const).map((c) =>
        picoseconds(parameters[`T_${edge}_${c}`]),
      );
      if (min === undefined || typ === undefined || max === undefined) return undefined;
      return { min, typ, max };
    };
    const rise = corners('RISE');
    const fall = corners('FALL');
    if (!rise || !fall) {
      warn('a path whose delays are not numbers: ignored');
      return none;
    }
    if ([rise, fall].some((d) => d.min < 0 || d.typ < 0 || d.max < 0)) {
      warn('a path with a negative delay: ignored');
      return none;
    }
    const condition = bits('EN');
    if (condition[0] === '0') {
      warn('a path whose condition is always false: ignored');
      return none;
    }
    const edge = type === '$specify3' ? edgeOf(parameters.EDGE_EN, parameters.EDGE_POL) : undefined;
    const path: HdlPath = {
      from: bits('SRC') as number[],
      to: bits('DST') as number[],
      full: flag(parameters.FULL) === 1,
      ...(edge && { edge }),
      ...whenOf(condition),
      rise,
      fall,
      src,
    };
    return { paths: [path], checks: [] };
  }

  // $specrule: TYPE, SRC and DST with their edges and conditions, T_LIMIT and T_LIMIT2.
  const rule = String(parameters.TYPE ?? '');
  const unchecked = UNCHECKED[rule];
  if (unchecked) {
    warn(`${unchecked} is not checked (${CHECKED}): ignored`);
    return none;
  }
  const event = (side: 'SRC' | 'DST'): HdlCheckEvent => {
    const edge = edgeOf(parameters[`${side}_PEN`], parameters[`${side}_POL`]);
    return { bits: bits(side) as number[], ...(edge && { edge }), ...whenOf(bits(`${side}_EN`)) };
  };
  const limit = picoseconds(parameters.T_LIMIT_TYP);
  const limit2 = picoseconds(parameters.T_LIMIT2_TYP);
  if (limit === undefined || limit2 === undefined) {
    warn(`a ${rule} check whose limit is not a number: ignored`);
    return none;
  }
  const negative = (t: number) => {
    if (t >= 0) return false;
    warn(`a ${rule} check with a negative limit is not checked: ignored`);
    return true;
  };
  const src_ = event('SRC');
  const dst = event('DST');
  const check = (kind: HdlCheck['kind'], clock: HdlCheckEvent, data: HdlCheckEvent, t: number) =>
    ({ kind, clock, data, limit: t, src }) as HdlCheck;
  switch (rule) {
    // $setup(data, reference, limit): SRC is the data, DST the clock.
    case '$setup':
      return negative(limit) ? none : { paths: [], checks: [check('setup', dst, src_, limit)] };
    // $hold(reference, data, limit); one pin's opposite edges: a pulse width (no $width in Yosys);
    // its same edge: a cycle time (no $period).
    case '$hold': {
      if (negative(limit)) return none;
      const samePin =
        src_.bits.length === 1 && dst.bits.length === 1 && src_.bits[0] === dst.bits[0];
      if (!samePin) return { paths: [], checks: [check('hold', src_, dst, limit)] };
      if (src_.edge !== undefined && dst.edge !== undefined && src_.edge !== dst.edge) {
        // The pulse is armed at its start (`&&&` on the first edge).
        const end = { bits: dst.bits, edge: dst.edge };
        return { paths: [], checks: [check('width', src_, end, limit)] };
      }
      if (src_.edge !== undefined && src_.edge === dst.edge) {
        // The cycle is armed at its edge (`&&&` on the first one).
        const again = { bits: dst.bits, edge: dst.edge };
        return { paths: [], checks: [check('cycle', src_, again, limit)] };
      }
      warn(
        `a $hold of one pin is a pulse width between its opposite edges (posedge, then negedge) or a cycle time between its same edges: ignored`,
      );
      return none;
    }
    // $setuphold(reference, data, setup, hold).
    case '$setuphold': {
      const checks: HdlCheck[] = [];
      if (!negative(limit)) checks.push(check('setup', src_, dst, limit));
      if (!negative(limit2)) checks.push(check('hold', src_, dst, limit2));
      return { paths: [], checks };
    }
    // $recovery and $removal(reference, data, limit): SRC is the control's release, DST the clock.
    case '$recovery':
      return negative(limit) ? none : { paths: [], checks: [check('recovery', dst, src_, limit)] };
    case '$removal':
      return negative(limit) ? none : { paths: [], checks: [check('removal', dst, src_, limit)] };
    case '$recrem': {
      const checks: HdlCheck[] = [];
      if (!negative(limit)) checks.push(check('recovery', dst, src_, limit));
      if (!negative(limit2)) checks.push(check('removal', dst, src_, limit2));
      return { paths: [], checks };
    }
    default:
      warn(`a ${rule || 'timing'} check is not checked (${CHECKED}): ignored`);
      return none;
  }
}

/**
 * The module's timing among its settled ports: a path must run from input or inout bits to
 * output or inout bits, a check observe input or inout bits (a submodule's path inside the module
 * says nothing about its pins). What doesn't is dropped with a warning; checks the simulator can't
 * measure (a clock without an edge, a vector clock, a control's release without an edge) too.
 * Undefined when nothing is left.
 */
export function placeSpecify(
  timing: HdlSpecify,
  ports: readonly HdlPort[],
  warn: (message: string, src: string) => void,
): HdlSpecify | undefined {
  const sources = new Set<number>();
  const targets = new Set<number>();
  for (const port of ports) {
    for (const bit of port.bits) {
      if (typeof bit !== 'number') continue;
      if (port.dir !== 'out') sources.add(bit);
      if (port.dir !== 'in') targets.add(bit);
    }
  }
  const among = (bits: readonly HdlBit[], set: ReadonlySet<number>) =>
    bits.length > 0 && bits.every((b) => typeof b === 'number' && set.has(b));

  const paths = timing.paths.filter((path) => {
    if (among(path.from, sources) && among(path.to, targets)) return true;
    warn(
      "a path that doesn't run between the module's pins (a submodule's, inside it): ignored",
      path.src,
    );
    return false;
  });
  const checks = timing.checks.filter((check) => {
    const { kind, clock, data } = check;
    if (!among(clock.bits, sources) || !among(data.bits, sources)) {
      warn("a check of signals that aren't the module's input pins: ignored", check.src);
      return false;
    }
    if (clock.bits.length !== 1 || clock.edge === undefined) {
      warn(
        `a ${kind} check needs one clock pin and its edge (posedge or negedge): ignored`,
        check.src,
      );
      return false;
    }
    if ((kind === 'recovery' || kind === 'removal') && (data.bits.length !== 1 || !data.edge)) {
      warn(
        `a ${kind} check needs one control pin and the edge that releases it (posedge or negedge): ignored`,
        check.src,
      );
      return false;
    }
    return true;
  });
  return paths.length === 0 && checks.length === 0 ? undefined : { paths, checks };
}
