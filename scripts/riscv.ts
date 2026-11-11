/**
 * LLVM for RISC-V programs (HDL-7): finds the tools on the user's computer and turns a binary
 * into the image a Verilog memory's `$readmemh` reads. Used by `pnpm riscv:firmware`; `pnpm
 * check` never calls the tools: what they make is committed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The tools a program is built with, each an absolute path or a name found on the PATH. */
export interface Llvm {
  readonly clang: string;
  readonly lld: string;
  readonly objcopy: string;
  readonly objdump: string;
}

/**
 * Where LLVM is looked for: `LLVM_BIN` first, then Homebrew's `llvm` and `lld` (Apple's clang has
 * no RISC-V target), then the PATH.
 */
function folders(): string[] {
  const env = process.env.LLVM_BIN;
  const brew = ['/opt/homebrew/opt', '/usr/local/opt'].flatMap((p) => [
    `${p}/llvm/bin`,
    `${p}/lld/bin`,
  ]);
  return [...(env ? [env] : []), ...brew];
}

function find(name: string, accept: (path: string) => boolean = () => true): string | undefined {
  for (const folder of folders()) {
    const path = join(folder, name);
    if (existsSync(path) && accept(path)) return path;
  }
  return runs(name) && accept(name) ? name : undefined;
}

function runs(command: string): boolean {
  return spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
}

function targetsRiscv32(clang: string): boolean {
  const run = spawnSync(clang, ['--print-targets'], { encoding: 'utf8' });
  return run.status === 0 && /\briscv32\b/.test(run.stdout);
}

/** The tools, or the names of those missing. */
export function findLlvm(): Llvm | { readonly missing: readonly string[] } {
  const tools = {
    clang: find('clang', targetsRiscv32),
    lld: find('ld.lld'),
    objcopy: find('llvm-objcopy'),
    objdump: find('llvm-objdump'),
  };
  const missing = Object.entries(tools).flatMap(([name, path]) => (path ? [] : [name]));
  return missing.length > 0 ? { missing } : (tools as Llvm);
}

/**
 * A binary image as `$readmemh` reads it into a memory of 32-bit words: one word a line, eight
 * hex digits, packed little-endian as a RISC-V core fetches them (bytes 0–3 are word 0, byte 0
 * its low byte); the last word padded with zeros. `header` comes first as `//` comment lines.
 */
export function hexImage(bytes: Uint8Array, header: readonly string[] = []): string {
  const lines = header.map((line) => `// ${line}`.trimEnd());
  for (let at = 0; at < bytes.length; at += 4) {
    let word = 0;
    for (let i = 3; i >= 0; i--) word = word * 256 + (bytes[at + i] ?? 0);
    lines.push(word.toString(16).padStart(8, '0'));
  }
  return `${lines.join('\n')}\n`;
}
