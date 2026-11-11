/**
 * `pnpm riscv:firmware` (HDL-7): builds the PicoRV32 example's program from
 * `examples/verilog/picorv32/firmware/` with LLVM for RV32I, and writes next to it the image the
 * wrapper's `$readmemh` reads (`firmware.hex`) and the listing (`firmware.lst`: each instruction
 * with its address, its word and the C line it came from). Then `pnpm hdl:examples` puts the
 * image into the example. Not part of `pnpm check`: what it writes is committed. Deterministic:
 * the same sources and LLVM give the same files.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLlvm, hexImage } from './riscv.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'examples/verilog/picorv32');
const SOURCES = join(DIR, 'firmware');
/** The wrapper's RAM (`soc.v`): the image, its data and the stack fit in it. */
const RAM_BYTES = 4096;

const llvm = findLlvm();
if ('missing' in llvm) {
  console.error(
    `LLVM with the RISC-V target is missing (${llvm.missing.join(', ')}); macOS: brew install llvm lld, or set LLVM_BIN`,
  );
  process.exit(2);
}

/** Runs a tool in `cwd`, failing the script with its output if it fails. */
function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`${command} ${args.join(' ')}\n${result.stdout}${result.stderr}`);
    process.exit(1);
  }
  return result.stdout;
}

const out = mkdtempSync(join(tmpdir(), 'saltator-riscv-'));
try {
  const elf = join(out, 'firmware.elf');
  // Run in the sources' folder with relative names, and map the folder away in the debug
  // information, so neither the image nor the listing depends on where the repo is.
  run(
    llvm.clang,
    [
      '--target=riscv32-unknown-elf',
      '-march=rv32i',
      '-mabi=ilp32',
      '-Os',
      '-g',
      `-ffile-prefix-map=${SOURCES}=.`,
      '-ffreestanding',
      '-nostdlib',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-fuse-ld=lld',
      `--ld-path=${llvm.lld}`,
      '-Wl,-T,link.ld',
      '-Wl,--build-id=none',
      '-o',
      elf,
      'start.S',
      'main.c',
    ],
    SOURCES,
  );
  const bin = join(out, 'firmware.bin');
  run(llvm.objcopy, ['-O', 'binary', 'firmware.elf', bin], out);
  const bytes = new Uint8Array(readFileSync(bin));
  if (bytes.length > RAM_BYTES / 2) {
    console.error(`the image is ${bytes.length} bytes: more than half the ${RAM_BYTES}-byte RAM`);
    process.exit(1);
  }
  const header = [
    'PicoRV32 example program: built from firmware/ by `pnpm riscv:firmware`; do not edit.',
    `${bytes.length} bytes, 32-bit words little-endian from address 0 (firmware.lst lists them).`,
  ];
  writeFileSync(join(DIR, 'firmware.hex'), hexImage(bytes, header));
  // The listing finds the C source through the debug information (`./main.c`: run in SOURCES)
  // and names the ELF as given: its temporary path becomes the bare file name.
  const lines = run(llvm.objdump, ['-d', '-S', elf], SOURCES)
    .replaceAll(elf, 'firmware.elf')
    .split('\n')
    .map((line) => line.trimEnd());
  writeFileSync(join(DIR, 'firmware.lst'), `${lines.join('\n').trim()}\n`);
  console.log(`wrote examples/verilog/picorv32/firmware.hex (${bytes.length} bytes) and .lst`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
