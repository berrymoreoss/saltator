import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../src/circuit/index.ts';
import { nodeScriptHost } from './script-host.ts';
import { argumentsOf, type Source, testDocuments } from './test-circuits.ts';

const host = nodeScriptHost({ timeout: 5_000 });
const example = (id: string): Source => {
  const path = `examples/${id}.logic.json`;
  return { path, text: readFileSync(path, 'utf8') };
};

/** The Two-Digit Counter with the Decade Counter's clear gate (U3) taken out. */
function brokenCounter(): Source {
  const document = parseDocument(example('two-digit-counter').text);
  const circuits = document.circuits.map((c) =>
    c.id === 'decade-counter' ? { ...c, components: c.components.filter((p) => p.id !== 'U3') } : c,
  );
  return { path: 'broken.logic.json', text: serializeDocument({ ...document, circuits }) };
}

/** A one-circuit document whose test script is `script`. */
function scripted(script: string): Source {
  const document = parseDocument(example('half-adder').text);
  const circuits = document.circuits.map((c) => ({ ...c, testScript: script.split('\n') }));
  return { path: 'scripted.logic.json', text: serializeDocument({ ...document, circuits }) };
}

describe('testDocuments', () => {
  it('lists every bench and passes the examples', () => {
    const run = testDocuments([example('half-adder'), example('hello-led')], host);
    expect(run).toEqual({
      code: 0,
      lines: [
        'examples/half-adder.logic.json',
        '  ✓ Main › adds two bits  (4 µs)',
        'examples/hello-led.logic.json — no test scripts',
        '1 bench: 1 passed',
      ],
    });
  });

  it('shows failures with line, instant and values, and exits 1', () => {
    const run = testDocuments([brokenCounter()], host);
    expect(run.code).toBe(1);
    expect(run.lines).toContain(
      '  ✗ Decade Counter › counts to 9, carries, and starts again  (13 µs, 1 warning)',
    );
    expect(run.lines).toContain('      line 3 at 1 µs: Q[0..3] is 0xX, expected 0x0');
    expect(run.lines.at(-1)).toBe('6 benches: 0 passed, 6 failed');
  });

  it('reports logs, errors, scripts that don’t load and files that don’t', () => {
    const logged = testDocuments(
      [scripted("bench('a', (b) => {\n  b.log('hi');\n  b.oops();\n});")],
      host,
    );
    expect(logged).toEqual({
      code: 1,
      lines: [
        'scripted.logic.json',
        '  ✗ Main › a  (0 ps)',
        '      log line 2: hi',
        '      error: line 3: TypeError: b.oops is not a function',
        '1 bench: 0 passed, 1 failed',
      ],
    });
    const broken = testDocuments([scripted('bench(')], host);
    expect(broken.code).toBe(1);
    expect(broken.lines[1]).toMatch(/^ {2}! Main: the script doesn't load: line 1: SyntaxError/);
    expect(broken.lines.at(-1)).toBe("0 benches: 0 passed, 1 script didn't load");
    const unreadable = testDocuments([{ path: 'x.logic.json', text: '{' }], host);
    expect(unreadable.code).toBe(2);
    expect(unreadable.lines[1]).toMatch(/^ {2}! invalid circuit document:/);
  });
});

describe('argumentsOf', () => {
  it('takes files and a timeout, or the examples', () => {
    expect(argumentsOf(['a.logic.json', '--timeout=500'])).toEqual({
      files: ['a.logic.json'],
      timeout: 500,
    });
    expect(argumentsOf([]).files).toContain('examples/two-digit-counter.logic.json');
    expect(() => argumentsOf(['--watch'])).toThrow('unknown option --watch');
  });
});

describe('pnpm test:circuits', () => {
  const cli = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ['--import', './scripts/resolve-hooks.ts', 'scripts/test-circuits.ts', ...args],
      { encoding: 'utf8' },
    );

  it('runs from the command line: 0 when the benches pass, 1 when one fails, 2 for no file', () => {
    const ok = cli('examples/half-adder.logic.json');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('✓ Main › adds two bits');
    const dir = mkdtempSync(join(tmpdir(), 'test-circuits-'));
    const broken = brokenCounter();
    writeFileSync(join(dir, broken.path), broken.text);
    expect(cli(join(dir, broken.path)).status).toBe(1);
    const missing = cli(join(dir, 'missing.logic.json'));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('missing.logic.json');
    expect(cli('--nope').status).toBe(2);
  });
});
