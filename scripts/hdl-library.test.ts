import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIBRARY_MODULES } from '../src/library/verilog/modules';
import { librarySourceHash } from './hdl-library-hash';

const DIR = fileURLToPath(new URL('../src/library/verilog/', import.meta.url));
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.v'))
  .map((f) => f.replace(/\.v$/, ''))
  .sort();

describe('the library parts written in Verilog (HDL-2)', () => {
  it('are compiled from every source, and only those', () => {
    expect(Object.keys(LIBRARY_MODULES).sort()).toEqual(sources);
  });

  it.each(sources)('%s.v is unchanged since pnpm hdl:library compiled it', (name) => {
    const text = readFileSync(`${DIR}${name}.v`, 'utf8');
    expect(
      LIBRARY_MODULES[name]?.sha256,
      `${name}.v changed: run pnpm hdl:library (needs yosys) and commit modules.ts`,
    ).toBe(librarySourceHash(text));
  });

  it('hashes the text with its line endings made LF', () => {
    expect(librarySourceHash('a\r\nb\n')).toBe(librarySourceHash('a\nb\n'));
    expect(librarySourceHash('a')).not.toBe(librarySourceHash('b'));
  });
});
