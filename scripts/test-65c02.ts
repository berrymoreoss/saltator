/**
 * `pnpm test:65c02 [--limit=N] [--download-only] [opcodes…]` (R17a): runs SingleStepTests
 * 65x02 `wdc65c02/v1` (github.com/SingleStepTests/65x02, MIT; 10,000 cases per opcode, every
 * cycle's bus) on the W65C02S core. The files (≈ 1.2 GB) are downloaded once into
 * `node_modules/.cache/65x02/`. Opcodes are hex (`a9 6d`; default: all but `cb` WAI and `db` STP,
 * which the suite leaves out). Prints the failures (the first few per opcode) and a summary;
 * exit code 0 when every case passed, 1 otherwise, 2 for a download or argument problem.
 * Run by Node with `scripts/resolve-hooks.ts` (it imports `src/`).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSingleStepCase, type SingleStepCase } from '../src/library/cpu/single-step.ts';
import { W65C02S_OPCODES } from '../src/library/cpu/w65c02s-opcodes.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CACHE = join(ROOT, 'node_modules/.cache/65x02/wdc65c02/v1');
const SOURCE = 'https://raw.githubusercontent.com/SingleStepTests/65x02/main/wdc65c02/v1/';

/** The suite's opcodes: all but WAI and STP. */
export const SUITE_OPCODES = Array.from({ length: 256 }, (_, i) => i).filter(
  (opcode) => opcode !== 0xcb && opcode !== 0xdb,
);

const fileName = (opcode: number) => `${opcode.toString(16).padStart(2, '0')}.json`;

/** Downloads the opcodes' files that aren't cached yet, a few at a time. */
export async function download(opcodes: readonly number[]): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const missing = opcodes.filter((opcode) => !existsSync(join(CACHE, fileName(opcode))));
  let done = 0;
  const worker = async () => {
    for (;;) {
      const opcode = missing.shift();
      if (opcode === undefined) return;
      const name = fileName(opcode);
      const response = await fetch(SOURCE + name);
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const text = await response.text();
      const path = join(CACHE, name);
      writeFileSync(`${path}.part`, text);
      renameSync(`${path}.part`, path);
      done++;
      if (done % 16 === 0) process.stdout.write(`downloaded ${done} files\n`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

export function loadCases(opcode: number): SingleStepCase[] {
  return JSON.parse(readFileSync(join(CACHE, fileName(opcode)), 'utf8')) as SingleStepCase[];
}

async function main(args: readonly string[]): Promise<number> {
  let limit = Number.POSITIVE_INFINITY;
  let downloadOnly = false;
  const opcodes: number[] = [];
  for (const arg of args) {
    if (arg.startsWith('--limit=')) limit = Number(arg.slice(8));
    else if (arg === '--download-only') downloadOnly = true;
    else if (/^[0-9a-fA-F]{2}$/.test(arg)) opcodes.push(Number.parseInt(arg, 16));
    else {
      console.error(`unknown argument "${arg}"`);
      return 2;
    }
  }
  if (!(limit > 0)) {
    console.error('--limit must be a positive number');
    return 2;
  }
  const selected = opcodes.length > 0 ? opcodes : SUITE_OPCODES;
  try {
    await download(selected);
  } catch (error) {
    console.error(`download failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (downloadOnly) return 0;
  let cases = 0;
  let failed = 0;
  const failedOpcodes: string[] = [];
  for (const opcode of selected) {
    const all = loadCases(opcode);
    let failures = 0;
    // The opcode table's cycles are the fewest any case takes (5C: the data sheet's 8).
    const fewest = Math.min(...all.map((test) => test.cycles.length));
    const table = W65C02S_OPCODES[opcode]?.cycles;
    if (opcode !== 0x5c && table !== fewest) {
      failures++;
      failed++;
      console.log(
        `${fileName(opcode)}: the opcode table says ${table} cycles, the cases ${fewest}`,
      );
    }
    for (const test of all.slice(0, limit)) {
      cases++;
      const problems = runSingleStepCase(test);
      if (problems.length === 0) continue;
      failed++;
      failures++;
      if (failures <= 3) console.log(`${fileName(opcode)} "${test.name}": ${problems.join('; ')}`);
    }
    if (failures > 0) failedOpcodes.push(`${opcode.toString(16).padStart(2, '0')} (${failures})`);
  }
  console.log(
    `${cases - failed} of ${cases} cases passed on ${selected.length} opcodes` +
      (failedOpcodes.length > 0 ? `; failing: ${failedOpcodes.join(', ')}` : ''),
  );
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
