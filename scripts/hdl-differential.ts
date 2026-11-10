/**
 * `pnpm hdl:differential` (HDL-9): the interpreter's reference — Yosys's own `sim` on the same
 * netlists. Generates seeded random expressions over every word cell (signed and unsigned, 1 to 80
 * bits), takes the sequential designs of `src/library/hdl/differential/*.v` and the examples'
 * `examples/verilog/*.v`, synthesizes each with the system `yosys` and the command, drives it with
 * seeded input vectors (a Yosys witness, replayed by `sim -r`) and records every output at every
 * step from the VCD `sim` writes. The IR, the vectors and Yosys's outputs are written to
 * `src/library/hdl/differential.ts`, which `differential.test.ts` checks the interpreter against —
 * so `pnpm check` never runs Yosys. Inputs named `clk…` are clocks: a data step, then the clock
 * rises, then it falls, so no data changes with a clock (a race, which the interpreter makes `X`
 * on purpose). Resets (`rst…`, `reset…`; `…_n` active LOW) are active one step in eight.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type HdlModule, SeededRandom } from '../src/core/index.ts';
import { fromYosys } from '../src/library/index.ts';
import { hasYosys, runYosys } from './yosys.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DESIGNS = join(ROOT, 'src/library/hdl/differential');
const EXAMPLES = join(ROOT, 'examples/verilog');
const OUT = join(ROOT, 'src/library/hdl/differential.ts');

/** Random combinational modules, their outputs each and the vectors each is driven with. */
const RANDOM_MODULES = 8;
const RANDOM_OUTPUTS = 12;
const RANDOM_STEPS = 32;
/** Clock cycles a sequential design is driven for (three steps each). */
const CYCLES = 40;
/** How long Yosys's `sim` may take on one design (it can loop on a design it can't settle). */
const SIM_TIMEOUT = 60_000;

/** One design checked against Yosys: what `differential.test.ts` reads. */
export interface DifferentialCase {
  readonly module: HdlModule;
  /** Input ports, in the order of each step's values. */
  readonly inputs: readonly string[];
  /** Output ports, in the order of each step's expected values. */
  readonly outputs: readonly string[];
  /** Per step, each input's value, most significant bit first. */
  readonly steps: readonly (readonly string[])[];
  /** Per step, each output's value as Yosys's `sim` gives it (`x` where unknown). */
  readonly expected: readonly (readonly string[])[];
}

interface Port {
  readonly name: string;
  readonly width: number;
}

/**
 * The binary operators. Not `===` and `!==`: Yosys's sim compares an `x` (a zero divisor, a select
 * out of range) literally, where the interpreter, as a board, doesn't know (Q1 of HDL-9); with
 * known operands they are `==` and `!=`, which are here.
 */
const BINARY = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '&',
  '|',
  '^',
  '~^',
  '<<',
  '>>',
  '<<<',
  '>>>',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
] as const;
const UNARY = ['-', '~', '!', '&', '|', '^', '~&', '~|', '~^'] as const;
const WIDTHS = [1, 2, 3, 4, 5, 7, 8, 8, 12, 16, 24, 31, 32, 33, 40, 63, 64, 65, 80] as const;

/**
 * A random module of expressions over six inputs of random widths and signedness — every input
 * and constant signed when `signed`: Verilog makes an operation signed only when all its operands
 * are, so mixed modules rarely divide or shift signed numbers.
 */
function randomModule(seed: number, signed: boolean): string {
  const random = new SeededRandom(seed);
  const below = (n: number) => random.nextUint32() % n;
  const pick = <T>(list: readonly T[]): T => list[below(list.length)]!;
  const chance = (p: number) => random.nextUint32() / 2 ** 32 < p;
  // Ports named by letters: digits would make pins clash (o1's bit 10 and o11's bit 0: o110).
  const letter = (k: number) => String.fromCharCode(97 + k);
  const inputs = Array.from({ length: 6 }, (_, i) => ({
    name: `x${letter(i)}`,
    width: pick(WIDTHS),
    signed: signed || chance(0.4),
  }));
  const constant = () => {
    const width = pick([1, 3, 4, 8, 16, 33]);
    let value = 0n;
    for (let i = 0; i < width; i += 32) value = (value << 32n) | BigInt(random.nextUint32());
    value = BigInt.asUintN(width, value);
    return `${width}'${signed || chance(0.3) ? 's' : ''}h${value.toString(16)}`;
  };
  const leaf = () => (chance(0.8) ? pick(inputs).name : constant());
  const expr = (depth: number): string => {
    if (depth === 0 || chance(0.15)) return leaf();
    const kind = below(10);
    if (kind < 5) {
      const op = pick(BINARY);
      // A power of mixed signedness: Yosys's sim reads it unsigned, Verilog (and Yosys's own
      // simlib.v, and the interpreter) gives the exponent its own sign. Both cast alike here.
      if (op === '**') {
        const cast = pick(['$signed', '$unsigned']);
        return `(${cast}(${expr(depth - 1)}) ** ${cast}(${expr(depth - 1)}))`;
      }
      return `(${expr(depth - 1)} ${op} ${expr(depth - 1)})`;
    }
    if (kind < 6) return `(${pick(UNARY)}${expr(depth - 1)})`;
    if (kind < 7) return `(${expr(depth - 1)} ? ${expr(depth - 1)} : ${expr(depth - 1)})`;
    if (kind < 8) {
      const input = pick(inputs);
      return `${input.name}[${expr(depth - 1)} +: ${1 + below(input.width)}]`;
    }
    if (kind < 9) return `${pick(['$signed', '$unsigned'])}(${expr(depth - 1)})`;
    return `{${expr(depth - 1)}, ${expr(depth - 1)}}`;
  };
  const declare = (dir: string, name: string, width: number, signed: boolean) =>
    `${dir} ${signed ? 'signed ' : ''}[${width - 1}:0] ${name}`;
  const ports = inputs.map((p) => declare('input', p.name, p.width, p.signed));
  const body: string[] = [];
  for (let k = 0; k < RANDOM_OUTPUTS; k++) {
    const width = pick(WIDTHS);
    const signed = chance(0.4);
    const o = `o${letter(k)}`;
    if (k < RANDOM_OUTPUTS - 2) {
      ports.push(declare('output', o, width, signed));
      body.push(`  assign ${o} = ${expr(2 + below(2))};`);
    } else {
      // A case statement: a $pmux over $eq cells.
      ports.push(declare('output reg', o, width, signed));
      body.push(
        `  wire [1:0] s${letter(k)} = ${expr(1)};`,
        `  always @* case (s${letter(k)}) 2'd0: ${o} = ${expr(2)}; 2'd1: ${o} = ${expr(2)}; 2'd2: ${o} = ${expr(1)}; default: ${o} = ${expr(1)}; endcase`,
      );
    }
  }
  return `// Generated by scripts/hdl-differential.ts, seed ${seed}.\nmodule random${seed} (\n  ${ports.join(',\n  ')}\n);\n${body.join('\n')}\nendmodule\n`;
}

const isClock = (name: string) => /^clk/i.test(name);
/** A reset's active level, or undefined for a plain input. */
const resetLevel = (name: string) =>
  /^(rst|reset)/i.test(name) ? (/_n$/i.test(name) ? 0 : 1) : undefined;

/** The input vectors: per step, each input's value, most significant bit first. */
function stimulus(inputs: readonly Port[], seed: number): string[][] {
  const random = new SeededRandom(seed);
  const bits = (width: number) =>
    Array.from({ length: width }, () => (random.nextUint32() & 1 ? '1' : '0')).join('');
  const clocked = inputs.some((p) => isClock(p.name));
  const value: string[] = inputs.map((p) => '0'.repeat(p.width));
  const steps: string[][] = [];
  const count = clocked ? 3 * CYCLES : RANDOM_STEPS;
  for (let step = 0; step < count; step++) {
    const phase = clocked ? step % 3 : 0;
    for (const [i, port] of inputs.entries()) {
      if (isClock(port.name)) value[i] = phase === 1 ? '1' : '0';
      else if (phase !== 0) continue;
      else {
        const reset = resetLevel(port.name);
        // Hold a reset for the first cycle, then pulse it now and then.
        const active = step < 3 || random.nextUint32() % 8 === 0;
        value[i] = reset === undefined ? bits(port.width) : String(active ? reset : 1 - reset);
      }
    }
    steps.push([...value]);
  }
  return steps;
}

/** A Yosys witness that drives `inputs` with `steps` (signals in reverse order, MSB first). */
function witness(inputs: readonly Port[], steps: readonly (readonly string[])[]): string {
  return JSON.stringify({
    format: 'Yosys Witness Trace',
    clocks: [],
    signals: inputs.map((p) => ({
      path: [`\\${p.name}`],
      offset: 0,
      width: p.width,
      init_only: false,
    })),
    steps: steps.map((values) => ({ bits: [...values].reverse().join('') })),
  });
}

/** Each output's value at each step, from the VCD `sim` wrote (step k at time 10k). */
function readVcd(text: string, outputs: readonly Port[], steps: number): string[][] {
  const ids = new Map<string, string>();
  for (const match of text.matchAll(/\$var \w+ (\d+) (\S+) (\S+)(?: \[[^\]]*\])? \$end/g)) {
    ids.set(match[3]!, match[2]!);
  }
  const current = new Map<string, string>();
  const result: string[][] = [];
  let time = 0;
  const record = (until: number) => {
    while (result.length < steps && result.length * 10 < until) {
      result.push(outputs.map((p) => current.get(ids.get(p.name) ?? '') ?? 'x'.repeat(p.width)));
    }
  };
  const widthOf = new Map(outputs.map((p) => [ids.get(p.name) ?? '', p.width]));
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      const next = Number(line.slice(1));
      if (next > time) record(next);
      time = next;
    } else if (/^b[01xz]+ /.test(line)) {
      const [bitsText, id] = line.slice(1).split(' ') as [string, string];
      const width = widthOf.get(id);
      if (width === undefined) continue;
      // VCD may leave out leading bits: 0s, or the leftmost x/z repeated.
      const fillChar = bitsText[0] === 'x' || bitsText[0] === 'z' ? bitsText[0] : '0';
      current.set(id, bitsText.padStart(width, fillChar).replaceAll('z', 'x'));
    } else if (/^[01xz]\S+$/.test(line)) {
      const id = line.slice(1);
      if (widthOf.has(id)) current.set(id, line[0] === 'z' ? 'x' : line[0]!);
    }
  }
  record(Infinity);
  return result;
}

/** Synthesizes `path`, drives it with seeded vectors in Yosys's `sim`; undefined if it can't. */
function differential(path: string, seed: number): DifferentialCase | undefined {
  const run = runYosys(path);
  if (run.json === undefined) throw new Error(`${path}: yosys failed\n${run.log}`);
  const { module, messages } = fromYosys(run.json);
  if (!module) {
    throw new Error(`${path}: ${messages.map((m) => `${m.src ?? '-'}: ${m.message}`).join('; ')}`);
  }
  if (module.ports.some((p) => p.dir === 'inout')) return undefined;
  const inputs = module.ports
    .filter((p) => p.dir === 'in')
    .map((p) => ({ name: p.name, width: p.bits.length }));
  const outputs = module.ports
    .filter((p) => p.dir === 'out')
    .map((p) => ({ name: p.name, width: p.bits.length }));
  const steps = stimulus(inputs, seed);
  const dir = mkdtempSync(join(tmpdir(), 'saltator-differential-'));
  try {
    writeFileSync(join(dir, 'module.json'), run.json);
    writeFileSync(join(dir, 'stimulus.yw'), witness(inputs, steps));
    const sim = spawnSync(
      'yosys',
      ['-q', '-p', `read_json module.json; sim -r stimulus.yw -scope ${module.top} -vcd out.vcd`],
      { cwd: dir, encoding: 'utf8', timeout: SIM_TIMEOUT },
    );
    if (sim.error) throw new Error(`${path}: yosys sim didn't finish: ${sim.error.message}`);
    if (sim.status !== 0) throw new Error(`${path}: yosys sim failed\n${sim.stdout}${sim.stderr}`);
    const expected = readVcd(readFileSync(join(dir, 'out.vcd'), 'utf8'), outputs, steps.length);
    return {
      module,
      inputs: inputs.map((p) => p.name),
      outputs: outputs.map((p) => p.name),
      steps,
      expected,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!hasYosys()) {
  console.error('yosys is not on the PATH (macOS: brew install yosys)');
  process.exit(2);
}

const cases: [string, DifferentialCase][] = [];
// `HDL_DIFFERENTIAL_KEEP=<dir>` keeps the random modules' sources there, to look into a mismatch.
const keep = process.env.HDL_DIFFERENTIAL_KEEP;
const scratch = keep ?? mkdtempSync(join(tmpdir(), 'saltator-random-'));
try {
  for (let seed = 1; seed <= RANDOM_MODULES; seed++) {
    const path = join(scratch, `random${seed}.v`);
    writeFileSync(path, randomModule(seed, seed > RANDOM_MODULES / 2));
    const found = differential(path, seed);
    if (found) cases.push([`random${seed}`, found]);
  }
} finally {
  if (!keep) rmSync(scratch, { recursive: true, force: true });
}
const sources = [
  ...readdirSync(DESIGNS).map((f) => join(DESIGNS, f)),
  ...readdirSync(EXAMPLES).map((f) => join(EXAMPLES, f)),
].filter((f) => f.endsWith('.v'));
for (const [i, path] of sources.sort().entries()) {
  const started = Date.now();
  const found = differential(path, 1000 + i);
  console.log(`${basename(path)}: ${Date.now() - started} ms`);
  if (found) cases.push([basename(path, '.v'), found]);
}

let bits = 0;
let unknown = 0;
for (const [name, c] of cases) {
  for (const step of c.expected) {
    for (const value of step) {
      bits += value.length;
      unknown += value.split('x').length - 1;
    }
  }
  console.log(`${name}: ${c.module.cells.length} cells, ${c.steps.length} steps`);
}
const quote = (text: string) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
writeFileSync(
  OUT,
  `/**
 * Generated by scripts/hdl-differential.ts (\`pnpm hdl:differential\`) — do not edit. Per design:
 * its IR, input vectors and every output at every step as Yosys's own \`sim\` gives it, for
 * differential.test.ts. ${bits} output bits, ${unknown} of them x.
 */
export const DIFFERENTIAL: Readonly<Record<string, string>> = {
${cases.map(([name, c]) => `  ${quote(name)}: ${quote(JSON.stringify(c))},`).join('\n')}
};
`,
);
spawnSync('pnpm', ['biome', 'format', '--write', OUT], { stdio: 'ignore' });
console.log(`wrote ${cases.length} designs, ${bits} output bits (${unknown} x)`);
