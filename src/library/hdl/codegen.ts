/**
 * JavaScript generated from a module's IR (HDL-10, ADR-0037): each combinational cell or latch
 * as a block of word operations over an instance's planes (`layout.ts`) — its operands read by
 * shifts and masks found once, its outputs computed 32 bits at a time with the same `X` rules as
 * the cells' semantics (`cells.ts`, `word-cells.ts`), written only where they changed. Uncommon
 * cells (divisions, powers, `$bmux`, arithmetic past 32 bits, shifts, …) run those semantics
 * through an adapter: their bits copied to small byte planes and back.
 *
 * The source is made from this file's templates alone. The only values from the IR that enter it
 * are integers — word indices, bit positions, masks, widths, polarities — each through `int`,
 * which refuses anything else; no name, location or other text from a document ever does.
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import { HDL_CELLS, type HdlBit, type HdlCell, type HdlCellSpec, hdlCellOutput } from '../../core';
import { compileStep } from './cells';
import {
  extendBits,
  type Layout,
  type Limb,
  limbsOf,
  maskOf,
  type Operand,
  operand,
  type Run,
} from './layout';
import { newPlanes, planeIndex, signedOperands } from './planes';

/** A cell's semantics on words, run by generated code as `C[slot](V, U)`. */
export type WordClosure = (V: Int32Array, U: Int32Array) => void;

/**
 * An integer as source text: the one way a value reaches generated code. Throws on anything that
 * isn't a safe integer, so text from a document can never become code.
 */
export function int(n: number): string {
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    throw new Error(`generated code takes integers only, not ${String(n)}`);
  }
  return String(n);
}

/** A 32-bit mask as a signed integer literal (`0xffffffff` → `-1`). */
const i32 = (n: number) => int(n | 0);

/** The cells written as word operations; the others go through the adapter. */
const NATIVE = new Set<HdlCell['type']>([
  '$not',
  '$pos',
  '$and',
  '$or',
  '$xor',
  '$xnor',
  '$reduce_and',
  '$reduce_or',
  '$reduce_bool',
  '$logic_not',
  '$reduce_xor',
  '$reduce_xnor',
  '$logic_and',
  '$logic_or',
  '$mux',
  '$pmux',
  '$bwmux',
  '$eq',
  '$ne',
  '$eqx',
  '$nex',
  '$lt',
  '$le',
  '$gt',
  '$ge',
  '$add',
  '$sub',
  '$neg',
  '$mul',
  '$tribuf',
  '$dlatch',
  '$adlatch',
]);

/** A run's bits in their place in an operand's limb, from `plane` (`V` or `U`). */
function runExpr(run: Run, plane: string): string {
  const word = `${plane}[${int(run.word)}]`;
  if (run.kind === 'fill') {
    return `(-((${word} >>> ${int(run.from)}) & 1) & ${i32(maskOf(run.length) * 2 ** run.to)})`;
  }
  if (run.from === 0 && run.length === 32) return word;
  const shifted =
    run.from + run.length === 32
      ? `(${word} >>> ${int(run.from)})`
      : run.from === 0
        ? `(${word} & ${i32(maskOf(run.length))})`
        : `((${word} >>> ${int(run.from)}) & ${i32(maskOf(run.length))})`;
  return run.to === 0 ? shifted : `(${shifted} << ${int(run.to)})`;
}

/** An operand's limb from one plane: its runs and its constant bits. */
function limbExpr(limb: Limb, plane: 'V' | 'U'): string {
  const parts = limb.runs.map((run) => runExpr(run, plane));
  const constant = plane === 'V' ? limb.ones : limb.unknown;
  if (constant !== 0) parts.push(i32(constant));
  if (parts.length === 0) return '0';
  return parts.length === 1 ? parts[0]! : `(${parts.join(' | ')})`;
}

/** A tri-state value (0, 1, 2 = `X`) of an operand's bit 0 as source: `(V…) | ((U…) << 1)`. */
function bitExpr(limb: Limb): string {
  return `((${limbExpr(limb, 'V')} & 1) | ((${limbExpr(limb, 'U')} & 1) << 1))`;
}

/** A cell's polarity parameter: 1 (active high, the default) or 0. */
function polarity(cell: HdlCell, name: string): 0 | 1 {
  const p = cell.params[name] ?? 1;
  return int(p as number) === '0' ? 0 : 1;
}

/**
 * Declares `name` = whether a control is active (0, 1, 2 = `X`), from the tri-state `t`
 * (source) and the cell's polarity.
 */
const active = (name: string, t: string, p: 0 | 1) =>
  p === 1
    ? `const ${name} = ${t};`
    : `const ${name}0 = ${t}, ${name} = ${name}0 === 2 ? 2 : 1 - ${name}0;`;

/** The source of one cell, made by `Generator.cell`. */
interface CellSource {
  /** Statements that compute `y<k>v`, `y<k>u` (declared before them). */
  readonly compute: string;
}

/**
 * Makes the source of a module's cells over its layout. Collects the closures the source calls
 * (`C`), made from the cells' semantics for those without a template here.
 */
export class Generator {
  readonly closures: WordClosure[] = [];
  readonly #layout: Layout;
  readonly #cells: readonly HdlCell[];

  constructor(cells: readonly HdlCell[], layout: Layout) {
    this.#cells = cells;
    this.#layout = layout;
  }

  /** The words a cell's output has: its first one and how many. */
  outputWords(index: number): { first: number; count: number } {
    return { first: this.#layout.cellWord[index]!, count: this.#layout.cellWords[index]! };
  }

  /**
   * A cell's block: computes its output and, where a word of it changed, writes it and runs
   * `onChange` (source made by the caller, from integers).
   */
  cell(index: number, onChange: string): string {
    const cell = this.#cells[index]!;
    const { first, count } = this.outputWords(index);
    if (first < 0) return '';
    const words = Array.from({ length: count }, (_, k) => int(first + k));
    if (!isNative(cell)) {
      const slot = this.closures.length;
      this.closures.push(adapter(cell, this.#layout));
      const saved = words.map((w, k) => `o${k}v = V[${w}], o${k}u = U[${w}]`).join(', ');
      const differs = words.map((w, k) => `V[${w}] !== o${k}v || U[${w}] !== o${k}u`).join(' || ');
      return `{\nconst ${saved};\nC[${int(slot)}](V, U);\nif (${differs}) {\n${onChange}\n}\n}\n`;
    }
    const { compute } = this.#native(cell);
    const declare = words.map((_, k) => `y${k}v = 0, y${k}u = 0`).join(', ');
    const differs = words.map((w, k) => `y${k}v !== V[${w}] || y${k}u !== U[${w}]`).join(' || ');
    const write = words.map((w, k) => `V[${w}] = y${k}v; U[${w}] = y${k}u;`).join('\n');
    return `{\nlet ${declare};\n${compute}\nif (${differs}) {\n${write}\n${onChange}\n}\n}\n`;
  }

  /** An operand read into constants `<name><k>v`, `<name><k>u`: the statements and the limbs. */
  #read(name: string, bits: readonly HdlBit[]): { code: string; op: Operand } {
    const op = operand(this.#layout, bits);
    const code = op
      .map(
        (limb, k) =>
          `const ${name}${k}v = ${limbExpr(limb, 'V')}, ${name}${k}u = ${limbExpr(limb, 'U')};`,
      )
      .join('\n');
    return { code, op };
  }

  #native(cell: HdlCell): CellSource {
    const spec: HdlCellSpec = HDL_CELLS[cell.type];
    const y = hdlCellOutput(cell);
    const width = y.length;
    const limbs = limbsOf(width);
    const masks = Array.from({ length: limbs }, (_, k) => maskOf(Math.min(32, width - 32 * k)));
    const port = (name: string) => cell.ports[name] ?? [];
    const lines: string[] = [];
    /** Sets the output from a tri-state result `t` in bit 0, the rest 0 (`putBool`). */
    const putBool = (t: string) => {
      if (width > 0) lines.push(`y0v = ${t} & 1; y0u = ${t} >>> 1;`);
    };
    /** `t` = whether any bit of an operand is 1 (1), none can be (0), or it depends (2). */
    const anyOne = (t: string, name: string, op: Operand) => {
      const v = op.map((_, k) => `${name}${k}v`).join(' | ');
      const u = op.map((_, k) => `${name}${k}u`).join(' | ');
      lines.push(`const ${t} = (${v}) !== 0 ? 1 : (${u}) !== 0 ? 2 : 0;`);
    };
    /** `t` = whether all bits are 1 (1), one is surely 0 (0), or it depends (2). */
    const allOne = (t: string, name: string, op: Operand) => {
      const zero = op
        .map((limb, k) => `(~(${name}${k}v | ${name}${k}u) & ${i32(maskOf(limb.width))})`)
        .join(' | ');
      const u = op.map((_, k) => `${name}${k}u`).join(' | ');
      lines.push(`const ${t} = (${zero}) !== 0 ? 0 : (${u}) !== 0 ? 2 : 1;`);
    };
    /** Reads `bits` extended to the output's width. */
    const readWide = (name: string, bits: readonly HdlBit[], signed: boolean) => {
      const { code } = this.#read(name, extendBits(bits, width, signed));
      lines.push(code);
    };
    /** Each output limb `k` from the template, `${k}` in it the limb, `${m}` its mask. */
    const perLimb = (template: (k: number, m: string) => string) => {
      for (let k = 0; k < limbs; k++) lines.push(template(k, i32(masks[k]!)));
    };
    /** Output limb `k` = merge of `p` and `q` limbs (equal known bits stay, the rest `X`). */
    const merge = (k: number, p: string, q: string, m: string) =>
      `y${k}u = (${p}u | ${q}u | (${p}v ^ ${q}v)) & ${m}; y${k}v = ${p}v & ~y${k}u & ${m};`;

    switch (cell.type) {
      case '$not':
      case '$pos': {
        readWide('a', port('A'), signedOperands(cell, 1));
        perLimb((k, m) =>
          cell.type === '$not'
            ? `y${k}u = a${k}u & ${m}; y${k}v = ~(a${k}v | a${k}u) & ${m};`
            : `y${k}u = a${k}u & ${m}; y${k}v = a${k}v & ${m};`,
        );
        break;
      }
      case '$and':
      case '$or':
      case '$xor':
      case '$xnor': {
        const signed = signedOperands(cell, 2);
        readWide('a', port('A'), signed);
        readWide('b', port('B'), signed);
        perLimb((k, m) => {
          const a = `a${k}`;
          const b = `b${k}`;
          switch (cell.type) {
            case '$and':
              return `y${k}v = ${a}v & ${b}v & ${m}; y${k}u = (${a}u | ${b}u) & (${a}v | ${a}u) & (${b}v | ${b}u) & ${m};`;
            case '$or':
              return `y${k}v = (${a}v | ${b}v) & ${m}; y${k}u = (${a}u | ${b}u) & ~y${k}v & ${m};`;
            case '$xor':
              return `y${k}u = (${a}u | ${b}u) & ${m}; y${k}v = (${a}v ^ ${b}v) & ~y${k}u & ${m};`;
            default:
              return `y${k}u = (${a}u | ${b}u) & ${m}; y${k}v = ~(${a}v ^ ${b}v) & ~y${k}u & ${m};`;
          }
        });
        break;
      }
      case '$reduce_and': {
        const { code, op } = this.#read('a', port('A'));
        lines.push(code);
        allOne('t', 'a', op);
        putBool('t');
        break;
      }
      case '$reduce_or':
      case '$reduce_bool':
      case '$logic_not': {
        const { code, op } = this.#read('a', port('A'));
        lines.push(code);
        anyOne('t', 'a', op);
        putBool(cell.type === '$logic_not' ? '(t === 2 ? 2 : 1 - t)' : 't');
        break;
      }
      case '$reduce_xor':
      case '$reduce_xnor': {
        const { code, op } = this.#read('a', port('A'));
        lines.push(code);
        const u = op.map((_, k) => `a${k}u`).join(' | ');
        const v = op.map((_, k) => `a${k}v`).join(' ^ ');
        const invert = cell.type === '$reduce_xnor' ? 1 : 0;
        lines.push(
          `let p = ${v}; p ^= p >>> 16; p ^= p >>> 8; p ^= p >>> 4; p ^= p >>> 2; p ^= p >>> 1;`,
          `const t = (${u}) !== 0 ? 2 : (p & 1) ^ ${int(invert)};`,
        );
        putBool('t');
        break;
      }
      case '$logic_and':
      case '$logic_or': {
        const a = this.#read('a', port('A'));
        const b = this.#read('b', port('B'));
        lines.push(a.code, b.code);
        anyOne('ta', 'a', a.op);
        anyOne('tb', 'b', b.op);
        lines.push(
          cell.type === '$logic_and'
            ? 'const t = ta === 0 || tb === 0 ? 0 : ta === 2 || tb === 2 ? 2 : 1;'
            : 'const t = ta === 1 || tb === 1 ? 1 : ta === 2 || tb === 2 ? 2 : 0;',
        );
        putBool('t');
        break;
      }
      case '$mux': {
        const s = operand(this.#layout, port('S'))[0]!;
        const a = this.#read('a', port('A'));
        const b = this.#read('b', port('B'));
        lines.push(`const s = ${bitExpr(s)};`);
        const take = (name: string) =>
          Array.from(
            { length: limbs },
            (_, k) => `y${k}v = ${name}${k}v; y${k}u = ${name}${k}u;`,
          ).join('\n');
        lines.push(
          `if (s === 0) {\n${a.code}\n${take('a')}\n} else if (s === 1) {\n${b.code}\n${take('b')}\n} else {\n${a.code}\n${b.code}`,
        );
        perLimb((k, m) => merge(k, `a${k}`, `b${k}`, m));
        lines.push('}');
        break;
      }
      case '$pmux':
        this.#pmux(cell, width, limbs, masks, lines, merge);
        break;
      case '$bwmux': {
        readWide('a', port('A'), false);
        readWide('b', port('B'), false);
        readWide('s', port('S'), false);
        perLimb(
          (k, m) =>
            `{ const x = s${k}u, one = s${k}v, zero = ~(s${k}v | s${k}u);\n` +
            `y${k}u = ((one & b${k}u) | (zero & a${k}u) | (x & (a${k}u | b${k}u | (a${k}v ^ b${k}v)))) & ${m};\n` +
            `y${k}v = ((one & b${k}v) | (zero & a${k}v) | (x & a${k}v & b${k}v)) & ~y${k}u & ${m}; }`,
        );
        break;
      }
      case '$eq':
      case '$ne':
      case '$eqx':
      case '$nex':
      case '$lt':
      case '$le':
      case '$gt':
      case '$ge':
        this.#comparison(cell, lines, putBool);
        break;
      case '$add':
      case '$sub':
      case '$neg':
      case '$mul':
        this.#arithmetic(cell, width, lines);
        break;
      case '$tribuf': {
        const en = operand(this.#layout, port('EN'))[0]!;
        readWide('a', port('A'), false);
        lines.push(`const e = ${bitExpr(en)};`);
        perLimb(
          (k, m) =>
            `if (e === 1) { y${k}v = a${k}v & ${m}; y${k}u = a${k}u & ${m}; } else { y${k}v = 0; y${k}u = ${m}; }`,
        );
        break;
      }
      case '$dlatch':
      case '$adlatch': {
        const en = operand(this.#layout, port('EN'))[0]!;
        lines.push(active('e', bitExpr(en), polarity(cell, 'EN_POLARITY')));
        readWide('d', port('D'), false);
        readWide('q', y, false);
        // `pick(e, d, q)`: D while enabled, held while not, merged while unknown.
        perLimb(
          (k, m) =>
            `let h${k}v, h${k}u;\nif (e === 1) { h${k}v = d${k}v; h${k}u = d${k}u; } else if (e === 0) { h${k}v = q${k}v; h${k}u = q${k}u; } else { h${k}u = (d${k}u | q${k}u | (d${k}v ^ q${k}v)) & ${m}; h${k}v = d${k}v & ~h${k}u; }`,
        );
        if (cell.type === '$adlatch') {
          const arst = operand(this.#layout, port('ARST'))[0]!;
          lines.push(active('r', bitExpr(arst), polarity(cell, 'ARST_POLARITY')));
          readWide('w', cell.params.ARST_VALUE as readonly HdlBit[], false);
          perLimb(
            (k, m) =>
              `if (r === 0) { y${k}v = h${k}v & ${m}; y${k}u = h${k}u & ${m}; } else if (r === 1) { y${k}v = w${k}v & ${m}; y${k}u = w${k}u & ${m}; } else { ${merge(k, `w${k}`, `h${k}`, m)} }`,
          );
        } else {
          perLimb((k, m) => `y${k}v = h${k}v & ${m}; y${k}u = h${k}u & ${m};`);
        }
        break;
      }
      default:
        throw new Error(`${spec.kind} cell ${cell.type} has no template`);
    }
    return { compute: lines.join('\n') };
  }

  /**
   * `$pmux`: the cases a select could pick — none (A), one (its slice of B, merged with A while
   * its select is unknown), or several at once (all `X`).
   */
  #pmux(
    cell: HdlCell,
    width: number,
    limbs: number,
    masks: readonly number[],
    lines: string[],
    merge: (k: number, p: string, q: string, m: string) => string,
  ): void {
    const s = this.#read('s', cell.ports.S ?? []);
    const a = this.#read('a', cell.ports.A ?? []);
    const b = cell.ports.B ?? [];
    const cases = (cell.ports.S ?? []).length;
    lines.push(s.code, 'let n = 0, at = -1, sure = 0;');
    for (let k = 0; k < s.op.length; k++) {
      lines.push(
        `{ const c = s${k}v | s${k}u; if (c !== 0) { n += (c & (c - 1)) !== 0 ? 2 : 1; at = ${int(32 * k + 31)} - Math.clz32(c); sure = s${k}v & c; } }`,
      );
    }
    const take = (name: string) =>
      Array.from({ length: limbs }, (_, k) => `y${k}v = ${name}${k}v; y${k}u = ${name}${k}u;`).join(
        '\n',
      );
    const allX = Array.from(
      { length: limbs },
      (_, k) => `y${k}v = 0; y${k}u = ${i32(masks[k]!)};`,
    ).join('\n');
    const branches: string[] = [];
    for (let c = 0; c < cases; c++) {
      const slice = this.#read('b', b.slice(c * width, (c + 1) * width));
      const pick = Array.from({ length: limbs }, (_, k) =>
        merge(k, `a${k}`, `b${k}`, i32(masks[k]!)),
      ).join('\n');
      branches.push(
        `case ${int(c)}: {\n${slice.code}\nif (sure !== 0) {\n${take('b')}\n} else {\n${a.code}\n${pick}\n}\nbreak;\n}`,
      );
    }
    lines.push(
      `if (n === 0) {\n${a.code}\n${take('a')}\n} else if (n > 1) {\n${allX}\n} else {\nswitch (at) {\n${branches.join('\n')}\n}\n}`,
    );
  }

  /**
   * The comparisons up to 32 bits at the wider operand's width, signed when both are: equality
   * by the known bits, order by the ranges the unknown bits allow; wider, equality per limb and
   * order through the adapter.
   */
  #comparison(cell: HdlCell, lines: string[], putBool: (t: string) => void): void {
    const op = cell.type;
    const signed = signedOperands(cell, 2);
    const aBits = cell.ports.A ?? [];
    const bBits = cell.ports.B ?? [];
    const width = Math.max(aBits.length, bBits.length);
    const a = this.#read('a', extendBits(aBits, width, signed));
    const b = this.#read('b', extendBits(bBits, width, signed));
    lines.push(a.code, b.code);
    const equal = op === '$eq' || op === '$eqx' ? 1 : 0;
    if (op === '$eq' || op === '$ne' || op === '$eqx' || op === '$nex') {
      const n = a.op.length;
      const differ = Array.from(
        { length: n },
        (_, k) => `((a${k}v ^ b${k}v) & ~(a${k}u | b${k}u))`,
      ).join(' | ');
      const unknown = Array.from({ length: n }, (_, k) => `a${k}u | b${k}u`).join(' | ');
      lines.push(
        `const t = (${differ}) !== 0 ? ${int(1 - equal)} : (${unknown}) !== 0 ? 2 : ${int(equal)};`,
      );
      putBool('t');
      return;
    }
    if (width > 32) throw new Error('wide orders go through the adapter');
    const flip = i32(signed && width > 0 ? 2 ** (width - 1) : 0);
    lines.push(
      `const aMin = ((a0v ^ ${flip}) & ~a0u) >>> 0, aMax = ((a0v ^ ${flip}) | a0u) >>> 0;`,
      `const bMin = ((b0v ^ ${flip}) & ~b0u) >>> 0, bMax = ((b0v ^ ${flip}) | b0u) >>> 0;`,
    );
    const below = 'aMax < bMin';
    const atLeast = 'aMin >= bMax';
    const above = 'aMin > bMax';
    const atMost = 'aMax <= bMin';
    const order =
      op === '$lt'
        ? `${below} ? 1 : ${atLeast} ? 0 : 2`
        : op === '$le'
          ? `${atMost} ? 1 : ${above} ? 0 : 2`
          : op === '$gt'
            ? `${above} ? 1 : ${atMost} ? 0 : 2`
            : `${atLeast} ? 1 : ${below} ? 0 : 2`;
    lines.push(`const t = ${order};`);
    putBool('t');
  }

  /** `$add`, `$sub`, `$neg`, `$mul` up to 32 bits: unknown from the lowest unknown bit up. */
  #arithmetic(cell: HdlCell, width: number, lines: string[]): void {
    const op = cell.type;
    const signed = signedOperands(cell, op === '$neg' ? 1 : 2);
    const a = this.#read('a', extendBits(cell.ports.A ?? [], width, signed));
    const b = this.#read('b', extendBits(cell.ports.B ?? [], width, signed));
    lines.push(a.code, b.code);
    const m = i32(maskOf(width));
    const r =
      op === '$add'
        ? '(a0v + b0v)'
        : op === '$sub'
          ? '(a0v - b0v)'
          : op === '$mul'
            ? 'Math.imul(a0v, b0v)'
            : '(-a0v)';
    lines.push(
      `const u = (a0u | b0u) & ${m};`,
      `const x = u === 0 ? 0 : ${m} & ~((u & -u) - 1);`,
      `y0u = x; y0v = ${r} & ${m} & ~x;`,
    );
  }
}

/**
 * The cells `indices` as one function over the planes (for tests and the engine): each cell's
 * block in that order, `onChange` run where one's output changed.
 */
export function compileCells(
  cells: readonly HdlCell[],
  layout: Layout,
  indices: readonly number[],
  onChange = '',
): WordClosure {
  const generator = new Generator(cells, layout);
  const body = indices.map((index) => generator.cell(index, onChange)).join('');
  const run = new Function('V', 'U', 'C', `'use strict';\n${body}`) as (
    V: Int32Array,
    U: Int32Array,
    C: readonly WordClosure[],
  ) => void;
  const closures = generator.closures;
  return (V, U) => run(V, U, closures);
}

/** Whether a cell is written as word operations (else it runs through the adapter). */
export function isNative(cell: HdlCell): boolean {
  if (!NATIVE.has(cell.type)) return false;
  const y = hdlCellOutput(cell).length;
  const a = (cell.ports.A ?? []).length;
  const b = (cell.ports.B ?? []).length;
  switch (cell.type) {
    case '$add':
    case '$sub':
    case '$neg':
    case '$mul':
      return y <= 32;
    case '$lt':
    case '$le':
    case '$gt':
    case '$ge':
      return Math.max(a, b) <= 32;
    default:
      return true;
  }
}

/**
 * A cell through the adapter: its bits copied from the words into small byte planes, its step
 * from the cells' semantics (`compileStep`) run there, its output copied back.
 */
export function adapter(cell: HdlCell, layout: Layout): WordClosure {
  const local = new Map<number, number>();
  const remap = (bit: HdlBit): HdlBit => {
    if (typeof bit !== 'number') return bit;
    let index = local.get(bit);
    if (index === undefined) {
      index = local.size;
      local.set(bit, index);
    }
    return index;
  };
  const ports: Record<string, HdlBit[]> = {};
  for (const [name, bits] of Object.entries(cell.ports)) ports[name] = bits.map(remap);
  const params: Record<string, number | readonly HdlBit[]> = { ...cell.params };
  const n = local.size;
  const step = compileStep({ ...cell, ports, params }, n);
  const { val, unk } = newPlanes(n);
  const words = new Int32Array(n);
  const positions = new Int32Array(n);
  for (const [bit, index] of local) {
    words[index] = layout.word[bit]!;
    positions[index] = layout.pos[bit]!;
  }
  const output = hdlCellOutput(cell);
  const out = Int32Array.from(output, (bit) => planeIndex(remap(bit), n));
  const outWords = Int32Array.from(output, (bit) =>
    typeof bit === 'number' ? layout.word[bit]! : -1,
  );
  const outPositions = Int32Array.from(output, (bit) =>
    typeof bit === 'number' ? layout.pos[bit]! : 0,
  );
  return (V, U) => {
    for (let i = 0; i < n; i++) {
      const w = words[i]!;
      const p = positions[i]!;
      unk[i] = (U[w]! >>> p) & 1;
      val[i] = (V[w]! >>> p) & 1;
    }
    step(val, unk);
    for (let i = 0; i < out.length; i++) {
      const w = outWords[i]!;
      if (w < 0) continue;
      const m = 1 << outPositions[i]!;
      const b = out[i]!;
      U[w] = unk[b] ? U[w]! | m : U[w]! & ~m;
      V[w] = val[b] ? V[w]! | m : V[w]! & ~m;
    }
  };
}
