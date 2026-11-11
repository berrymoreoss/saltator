# PicoRV32

The sources of the example **Verilog PicoRV32** (`examples/verilog-picorv32.saltator.json`, roadmap
item HDL-7): a RISC-V CPU written in Verilog by someone else, run by the simulator as a module
with its memory and a program.

## What is upstream's

- `picorv32.v` — PicoRV32, a size-optimized RV32IMC core by Claire Xenia Wolf, unchanged from
  [YosysHQ/picorv32](https://github.com/YosysHQ/picorv32) at commit `ef203c2b`
  (2026-09-07; the repository is archived).
- `COPYING` — its license (ISC), which the file's header repeats.

## What is ours

- `soc.v` — the module the example places: the core (RV32I with the barrel shifter), 4 KB of
  RAM filled from `firmware.hex`, an 8-bit input port and an 8-bit output port, a power-on
  reset. Its header gives the memory map.
- `firmware/` — the program: `main.c` (the n-th Fibonacci number of the input port on the
  output port), `start.S` (the stack, `.bss`, `main`), `link.ld` (everything from address 0).
- `firmware.hex` — the program as `$readmemh` reads it: one 32-bit word a line, little-endian.
- `firmware.lst` — its disassembly: each instruction's address and word with the C line it came
  from.

## Rebuilding

The app never runs these tools; their output is committed.

1. The program, with LLVM (macOS: `brew install llvm lld`; `LLVM_BIN` points elsewhere):

   ```sh
   pnpm riscv:firmware      # firmware/ → firmware.hex, firmware.lst
   ```

2. The module, with Yosys — the command modules are made with, reading both files and naming the
   top module (`hierarchy -auto-top` would pick `picorv32_wb`, one of `picorv32.v`'s bus
   adapters):

   ```sh
   yosys -q -p 'read_verilog soc.v picorv32.v; hierarchy -top soc; proc -norom; flatten; tribuf -logic; opt -keepdc; memory_collect; check; write_json soc.json'
   ```

   In the app, paste `soc.json` into the module's view and Compile. The repo regenerates the
   example with `pnpm hdl:examples`, which does the same.

## Running another program

The image is Yosys's (`$readmemh`); the app's Reset brings it back. To try another program
without Yosys: pause the simulation, load its `.bin` or Intel HEX into `A1/ram` from the Memory
tab (bytes packed into words little-endian), and press the board's RESET. A test bench loads one
with `b.memory('A1/ram', 0, [words])` or `b.loadIntelHex('A1/ram', text)`.

## Power-up

The simulator has four states: a flip-flop without an initial value starts unknown (`X`). The
core's `mem_valid` is one, so at the first clock edge a write it might enable, at an unknown
address, would make the whole RAM unknown — a simulator where `if (x)` is false (Icarus) hides
it. `soc.v` therefore does nothing with its memory and ports while the core is in reset, and
holds the core in reset for its first 8 cycles by itself (`reg [3:0] boot = 0`, as an FPGA
starts its flip-flops from their initial values).
