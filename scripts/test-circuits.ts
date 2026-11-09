/**
 * `pnpm test:circuits [--timeout=ms] [files…]` (R15a): runs every test bench of every circuit
 * of each document (default: `examples/*.saltator.json`) in the Node script host and prints one
 * line per bench, every failure and error, the logs, and a summary. Exit code 0 when every
 * bench passed, 1 when one failed or erred (or a script didn't load), 2 when a file didn't load
 * or the arguments are wrong. Run by Node with `scripts/resolve-hooks.ts` (it imports `src/`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BenchResult,
  type CircuitDocument,
  loadTestScript,
  parseDocument,
  runBench,
  type ScriptHost,
} from '../src/circuit/index.ts';
import { formatTime } from '../src/core/index.ts';
import { createDefaultRegistry } from '../src/library/index.ts';
import { nodeScriptHost } from './script-host.ts';

/** A document to test: where it came from (for the report) and its text. */
export interface Source {
  readonly path: string;
  readonly text: string;
}

export interface TestRun {
  /** The report, line by line. */
  readonly lines: readonly string[];
  /** 0 passed, 1 a bench failed or erred, 2 a document didn't load. */
  readonly code: 0 | 1 | 2;
}

/** Runs the benches of every circuit of every document; never throws for a document's sake. */
export function testDocuments(sources: readonly Source[], host: ScriptHost): TestRun {
  const registry = createDefaultRegistry();
  const lines: string[] = [];
  let benches = 0;
  let passed = 0;
  let broken = 0; // scripts that didn't load
  let unreadable = 0;
  for (const { path, text } of sources) {
    let document: CircuitDocument;
    try {
      document = parseDocument(text);
    } catch (error) {
      unreadable++;
      lines.push(path, `  ! ${(error as Error).message.replaceAll('\n', '\n    ')}`);
      continue;
    }
    const tested = document.circuits.filter((c) => c.testScript.length > 0);
    lines.push(tested.length === 0 ? `${path} — no test scripts` : path);
    for (const circuit of tested) {
      const script = loadTestScript(circuit.testScript.join('\n'), host);
      if (script.error) {
        broken++;
        lines.push(`  ! ${circuit.name}: the script doesn't load: ${where(script.error)}`);
        continue;
      }
      for (const { name } of script.benches) {
        const result = runBench(document, circuit.id, name, registry, host);
        benches++;
        if (result.status === 'pass') passed++;
        lines.push(...benchLines(`${circuit.name} › ${name}`, result));
      }
    }
  }
  const failed = benches - passed;
  const summary = [
    `${benches} bench${benches === 1 ? '' : 'es'}: ${passed} passed`,
    ...(failed > 0 ? [`${failed} failed`] : []),
    ...(broken > 0 ? [`${broken} script${broken === 1 ? '' : 's'} didn't load`] : []),
    ...(unreadable > 0 ? [`${unreadable} file${unreadable === 1 ? '' : 's'} didn't load`] : []),
  ];
  lines.push(summary.join(', '));
  return { lines, code: unreadable > 0 ? 2 : failed > 0 || broken > 0 ? 1 : 0 };
}

/** A bench's lines: ✓ or ✗ with its name and simulated time, then what went wrong. */
export function benchLines(title: string, result: BenchResult): string[] {
  const mark = result.status === 'pass' ? '✓' : '✗';
  const warnings = result.warnings.length;
  const notes = [
    formatTime(result.time),
    ...(warnings > 0 ? [`${warnings} warning${warnings === 1 ? '' : 's'}`] : []),
  ];
  const lines = [`  ${mark} ${title}  (${notes.join(', ')})`];
  for (const log of result.logs) lines.push(`      log ${where({ ...log, message: log.text })}`);
  for (const failure of result.failures) {
    lines.push(`      ${where(failure, failure.time)}`);
  }
  const more = result.failureCount - result.failures.length;
  if (more > 0) lines.push(`      … and ${more} more`);
  if (result.error) lines.push(`      error: ${where(result.error)}`);
  return lines;
}

/** `line 7 at 1.25 µs: …`, as much of it as is known. */
function where(item: { readonly message: string; readonly line?: number }, time?: number): string {
  const place = [
    ...(item.line === undefined ? [] : [`line ${item.line}`]),
    ...(time === undefined ? [] : [`at ${formatTime(time)}`]),
  ].join(' ');
  return place === '' ? item.message : `${place}: ${item.message}`;
}

/** The documents a command line names, or the examples. */
export function argumentsOf(args: readonly string[]): { files: string[]; timeout?: number } {
  const files: string[] = [];
  let timeout: number | undefined;
  for (const arg of args) {
    const option = /^--timeout=(\d+)$/.exec(arg);
    if (option) timeout = Number(option[1]);
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else files.push(arg);
  }
  if (files.length === 0) {
    files.push(
      ...readdirSync('examples')
        .filter((name) => name.endsWith('.saltator.json'))
        .sort()
        .map((name) => join('examples', name)),
    );
  }
  return { files, ...(timeout !== undefined && { timeout }) };
}

function main(): void {
  let options: ReturnType<typeof argumentsOf>;
  try {
    options = argumentsOf(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\nusage: pnpm test:circuits [--timeout=ms] [files…]`);
    process.exit(2);
  }
  const sources: Source[] = [];
  let missing = false;
  for (const path of options.files) {
    try {
      sources.push({ path, text: readFileSync(path, 'utf8') });
    } catch (error) {
      console.error(`${path}: ${(error as Error).message}`);
      missing = true;
    }
  }
  const host = nodeScriptHost(options.timeout === undefined ? {} : { timeout: options.timeout });
  const run = testDocuments(sources, host);
  console.log(run.lines.join('\n'));
  process.exit(missing ? 2 : run.code);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
