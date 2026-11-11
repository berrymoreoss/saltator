/**
 * A module's flip-flops as generated code over an instance's words (HDL-10), with the semantics
 * of `cells.ts`: an edge's next states computed from the words before it into `NV`/`NU` (an
 * uncertain edge merging them with the stored state, so only the bits a load would change become
 * `X`), then loaded all at once, each flip-flop whose state changed marking the steps that read
 * it; the asynchronous controls (reset, load, per-bit set and clear) applied while active, merged
 * while unknown. Flip-flops clocked by one pin on one edge share their functions (a core's
 * registers: one call per edge); one clocked by logic or a constant has its own.
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import type { HdlBit, HdlCell } from '../../core';
import { type Layout, maskOf, operand } from './layout';
import { i32, int, limbExpr } from './source';

/** Next states of a group's flip-flops from the words `V`, `U` into `NV`, `NU`; `x`: uncertain. */
export type NextStates = (
  V: Int32Array,
  U: Int32Array,
  NV: Int32Array,
  NU: Int32Array,
  x: number,
) => void;

/** Loads a group's next states, marking (`D`) the readers of what changed. */
export type Loads = (
  V: Int32Array,
  U: Int32Array,
  NV: Int32Array,
  NU: Int32Array,
  D: Int32Array,
) => void;

/** Applies every asynchronous control; says whether a flip-flop changed (and marks its readers). */
export type AsyncControls = (V: Int32Array, U: Int32Array, D: Int32Array) => boolean;

/** A cell's polarity parameter: 1 (the default) or 0. */
function polarity(cell: HdlCell, name: string): 0 | 1 {
  return int((cell.params[name] as number | undefined) ?? 1) === '0' ? 0 : 1;
}

/** Whether a flip-flop cell has asynchronous controls. */
export const isAsync = (cell: HdlCell): boolean =>
  cell.ports.ARST !== undefined || cell.ports.SET !== undefined || cell.ports.ALOAD !== undefined;

/** Source for one bit of a port as a tri-state value (0, 1, 2), made active-high by `p`. */
function control(layout: Layout, bits: readonly HdlBit[], p: 0 | 1, name: string): string {
  const limb = operand(layout, bits)[0]!;
  const t = `((${limbExpr(limb, 'V')} & 1) | ((${limbExpr(limb, 'U')} & 1) << 1))`;
  return p === 1
    ? `const ${name} = ${t};`
    : `const ${name}0 = ${t}, ${name} = ${name}0 === 2 ? 2 : 1 - ${name}0;`;
}

/** `out` = pick(c, yes, no) for a control `c` of one bit: yes at 1, no at 0, merged at `X`. */
const pick = (c: string, yes: string, no: string, out: string, m: string) =>
  `if (${c} === 1) { ${out}v = ${yes}v; ${out}u = ${yes}u; } else if (${c} === 0) { ${out}v = ${no}v; ${out}u = ${no}u; } else { ${out}u = (${yes}u | ${no}u | (${yes}v ^ ${no}v)) & ${m}; ${out}v = ${yes}v & ~${out}u; }`;

/** The words of a flip-flop's `Q`: the first and how many. */
function qWords(layout: Layout, index: number): number[] {
  const first = layout.cellWord[index]!;
  return Array.from({ length: layout.cellWords[index]! }, (_, k) => first + k);
}

/** The masks of a flip-flop's limbs. */
const limbMasks = (cell: HdlCell) => {
  const width = (cell.ports.Q ?? []).length;
  return Array.from({ length: Math.max(1, Math.ceil(width / 32)) }, (_, k) =>
    i32(maskOf(Math.min(32, width - 32 * k))),
  );
};

/** The source of one flip-flop's next state. */
function nextSource(cell: HdlCell, index: number, layout: Layout): string {
  const lines: string[] = [];
  const hasEn = cell.ports.EN !== undefined;
  const hasSrst = cell.ports.SRST !== undefined;
  if (hasEn) lines.push(control(layout, cell.ports.EN!, polarity(cell, 'EN_POLARITY'), 'en'));
  if (hasSrst) lines.push(control(layout, cell.ports.SRST!, polarity(cell, 'SRST_POLARITY'), 'sr'));
  const d = operand(layout, cell.ports.D ?? []);
  const r = hasSrst ? operand(layout, cell.params.SRST_VALUE as readonly HdlBit[]) : undefined;
  const resetInside = cell.type === '$sdffce';
  const masks = limbMasks(cell);
  for (const [k, w] of qWords(layout, index).entries()) {
    const m = masks[k]!;
    const W = int(w);
    lines.push('{');
    lines.push(`const qv = V[${W}] & ${m}, qu = U[${W}] & ${m};`);
    lines.push(`const dv = ${limbExpr(d[k]!, 'V')}, du = ${limbExpr(d[k]!, 'U')};`);
    if (r) lines.push(`const rv = ${limbExpr(r[k]!, 'V')}, ru = ${limbExpr(r[k]!, 'U')};`);
    lines.push('let tv = dv, tu = du;');
    if (resetInside) {
      // $sdffce resets only while enabled.
      lines.push(
        'let iv = dv, iu = du;',
        pick('sr', 'r', 'd', 'i', m),
        pick('en', 'i', 'q', 't', m),
      );
    } else {
      if (hasEn) lines.push(pick('en', 'd', 'q', 't', m));
      if (hasSrst) lines.push('const hv = tv, hu = tu;', pick('sr', 'r', 'h', 't', m));
    }
    lines.push(
      `if (x !== 0) { tu = (qu | tu | (qv ^ tv)) & ${m}; tv = qv & ~tu; }`,
      `NV[${W}] = tv & ${m}; NU[${W}] = tu & ${m};`,
      '}',
    );
  }
  return `{\n${lines.join('\n')}\n}\n`;
}

/** The source of one flip-flop's load: its next state stored, its readers marked if it changed. */
function loadSource(index: number, layout: Layout, marks: string): string {
  const copies = qWords(layout, index)
    .map((w) => {
      const W = int(w);
      return `if (NV[${W}] !== V[${W}] || NU[${W}] !== U[${W}]) { V[${W}] = NV[${W}]; U[${W}] = NU[${W}]; c = 1; }`;
    })
    .join('\n');
  return `{\nlet c = 0;\n${copies}\nif (c !== 0) { ${marks} }\n}\n`;
}

/**
 * The source of one flip-flop's asynchronous controls: while active, the reset value, the loaded
 * `AD`, or per bit clear (which wins) and set; merged while unknown.
 */
function asyncSource(cell: HdlCell, index: number, layout: Layout, marks: string): string {
  const lines: string[] = [];
  const hasArst = cell.ports.ARST !== undefined;
  const hasAload = cell.ports.ALOAD !== undefined;
  const bits = cell.ports.SET !== undefined;
  if (hasArst) lines.push(control(layout, cell.ports.ARST!, polarity(cell, 'ARST_POLARITY'), 'r'));
  if (hasAload)
    lines.push(control(layout, cell.ports.ALOAD!, polarity(cell, 'ALOAD_POLARITY'), 'l'));
  const conditions = [hasArst ? 'r !== 0' : '', hasAload ? 'l !== 0' : '', bits ? 'true' : ''];
  const when = conditions.filter((c) => c !== '').join(' || ');
  const ad = hasAload ? operand(layout, cell.ports.AD!) : undefined;
  const rst = hasArst ? operand(layout, cell.params.ARST_VALUE as readonly HdlBit[]) : undefined;
  const set = bits ? operand(layout, cell.ports.SET!) : undefined;
  const clr = bits ? operand(layout, cell.ports.CLR!) : undefined;
  const setP = polarity(cell, 'SET_POLARITY');
  const clrP = polarity(cell, 'CLR_POLARITY');
  const masks = limbMasks(cell);
  const body: string[] = ['let c = 0;'];
  for (const [k, w] of qWords(layout, index).entries()) {
    const m = masks[k]!;
    const W = int(w);
    body.push('{', `const qv = V[${W}] & ${m}, qu = U[${W}] & ${m};`, 'let tv = qv, tu = qu;');
    if (ad) {
      body.push(
        `if (l !== 0) { const av = ${limbExpr(ad[k]!, 'V')}, au = ${limbExpr(ad[k]!, 'U')}; const hv = tv, hu = tu; ${pick('l', 'a', 'h', 't', m)} }`,
      );
    }
    if (rst) {
      body.push(
        `if (r !== 0) { const av = ${limbExpr(rst[k]!, 'V')}, au = ${limbExpr(rst[k]!, 'U')}; const hv = tv, hu = tu; ${pick('r', 'a', 'h', 't', m)} }`,
      );
    }
    if (set && clr) {
      /** Per bit: active (1), inactive (0), unknown masks of a control limb. */
      const masksOf = (name: string, p: 0 | 1) =>
        p === 1
          ? `const ${name}1 = ${name}v & ${m}, ${name}0 = ~(${name}v | ${name}u) & ${m}, ${name}x = ${name}u & ${m};`
          : `const ${name}1 = ~(${name}v | ${name}u) & ${m}, ${name}0 = ${name}v & ${m}, ${name}x = ${name}u & ${m};`;
      body.push(
        `const sv = ${limbExpr(set[k]!, 'V')}, su = ${limbExpr(set[k]!, 'U')};`,
        `const cv = ${limbExpr(clr[k]!, 'V')}, cu = ${limbExpr(clr[k]!, 'U')};`,
        masksOf('s', setP),
        masksOf('c', clrP),
        // pick(set, 1, t), then pick(clr, 0, that).
        `const xu = ((s0 & tu) | (sx & (tu | (~tv & ${m})))) & ${m};`,
        `const xv = (s1 | (s0 & tv) | (sx & tv)) & ~xu & ${m};`,
        `tu = ((c0 & xu) | (cx & (xu | xv))) & ${m};`,
        'tv = (c0 & xv) & ~tu;',
      );
    }
    body.push(`if (tv !== qv || tu !== qu) { V[${W}] = tv; U[${W}] = tu; c = 1; }`, '}');
  }
  body.push(`if (c !== 0) { ${marks} changed = true; }`);
  return `{\n${lines.join('\n')}\nif (${when}) {\n${body.join('\n')}\n}\n}\n`;
}

/** A group's next states: its flip-flops' functions in one. */
export function compileNextStates(
  cells: readonly HdlCell[],
  layout: Layout,
  members: readonly number[],
): NextStates {
  const body = members.map((index) => nextSource(cells[index]!, index, layout)).join('');
  return new Function('V', 'U', 'NV', 'NU', 'x', `'use strict';\n${body}`) as NextStates;
}

/** A group's loads; `marks(index)` is the source marking the readers of a flip-flop's words. */
export function compileLoads(
  layout: Layout,
  members: readonly number[],
  marks: (index: number) => string,
): Loads {
  const body = members.map((index) => loadSource(index, layout, marks(index))).join('');
  return new Function('V', 'U', 'NV', 'NU', 'D', `'use strict';\n${body}`) as Loads;
}

/** Every asynchronous flip-flop's controls in one function. */
export function compileAsyncControls(
  cells: readonly HdlCell[],
  layout: Layout,
  members: readonly number[],
  marks: (index: number) => string,
): AsyncControls {
  const body = members
    .map((index) => asyncSource(cells[index]!, index, layout, marks(index)))
    .join('');
  return new Function(
    'V',
    'U',
    'D',
    `'use strict';\nlet changed = false;\n${body}return changed;`,
  ) as AsyncControls;
}
