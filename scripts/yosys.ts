/**
 * Runs the system `yosys` (HDL-1, ADR-0030) with the command modules are made with
 * (`yosysScript`), for the repo's own fixtures and examples. `pnpm check` never calls it: what it
 * makes is committed. A source may override the script on its first line —
 * `// yosys: read_verilog {in}; …; write_json {out}` — for fixtures of what the converter refuses
 * (a netlist not flattened, a gate-level one).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { yosysScript } from '../src/library/hdl/command.ts';

/** What a run gave: the JSON netlist's text, or the log saying why there is none. */
export interface YosysRun {
  readonly json?: string;
  readonly log: string;
}

const OVERRIDE = /^\/\/ yosys: (.+)$/;

/** Sources read with the main one, and the top module, for a design of several files. */
export interface YosysDesign {
  /** More sources, in the main source's folder (`picorv32.v` next to `soc.v`). */
  readonly with?: readonly string[];
  /** The top module (`hierarchy -top`), where `-auto-top` would pick another one. */
  readonly top?: string;
}

/**
 * The script for a source: its first-line override (`{in}`: every source, `{out}` filled in), or
 * the command's.
 */
export function scriptFor(
  sourceText: string,
  input: string,
  output: string,
  design: YosysDesign = {},
): string {
  const inputs = [input, ...(design.with ?? [])];
  const first = sourceText.split('\n', 1)[0] ?? '';
  const match = OVERRIDE.exec(first.trim());
  return match
    ? match[1]!.replaceAll('{in}', inputs.join(' ')).replaceAll('{out}', output)
    : yosysScript(inputs, output, design.top);
}

/** Whether `yosys` is on the PATH. */
export function hasYosys(): boolean {
  return spawnSync('yosys', ['-V'], { encoding: 'utf8' }).status === 0;
}

/**
 * Synthesizes `path` (with `design`'s other sources) with the system `yosys`, run in the file's
 * folder so source locations read `decoder.v:12.3-12.20`. The JSON is returned as Yosys wrote it.
 */
export function runYosys(path: string, design: YosysDesign = {}): YosysRun {
  const dir = mkdtempSync(join(tmpdir(), 'saltator-yosys-'));
  try {
    const output = join(dir, 'out.json');
    const script = scriptFor(readFileSync(path, 'utf8'), basename(path), output, design);
    const run = spawnSync('yosys', ['-q', '-p', script], { cwd: dirname(path), encoding: 'utf8' });
    if (run.error) throw run.error;
    const log = `${run.stdout}${run.stderr}`.trim();
    if (run.status !== 0) return { log };
    return { json: readFileSync(output, 'utf8'), log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
