# Programmable logic

Track `HDL` of the [roadmap](../roadmap.md).

**Goal:** digital logic written in Verilog runs in the simulator as parts — modules the user
writes for the FPGA or CPLD they will build with, complex controllers in the library, soft cores
up to a PicoRV32 — through one pipeline: Yosys synthesizes the source, its netlist becomes an IR
(plain data), and one interpreter in the library runs it as an ordinary part, with pin delays,
timing checks, snapshots and test benches like every other part
([ADR-0030](../adr/0030-hdl-modules.md)). Then the programmable devices themselves (GAL, CPLD,
FPGA) as real parts with their data sheet timing.

**Not here:** hand-written parts ([Parts](parts.md)); whether the 6502's peripherals (R18,
[MOS 6502](mos6502.md)) are written in Verilog, decided when R18 starts; general tools the
modules use (waveforms, debugger, test benches — [Platform](platform.md)).

## Items

| ID    | Branch                | Title                         | Needs | Status  |
| ----- | --------------------- | ----------------------------- | ----- | ------- |
| HDL-1 | `feat/hdl-modules`    | Verilog modules in the kernel | —     | next    |
| HDL-2 | `feat/hdl-timing`     | Timing from specify blocks    | —     | planned |
| HDL-3 | `feat/hdl-editor`     | Verilog in the document       | —     | planned |
| HDL-4 | `feat/hdl-inspection` | Inside a module               | —     | planned |
| HDL-5 | `feat/pld-devices`    | Programmable devices          | —     | planned |
| HDL-6 | `feat/hdl-memories`   | Memories in modules           | —     | planned |
| HDL-7 | `example/picorv32`    | PicoRV32 soft core            | —     | planned |

## HDL-1 · Verilog modules in the kernel — `feat/hdl-modules`

The pipeline of [ADR-0030](../adr/0030-hdl-modules.md), headless. Yosys (packaged for
WebAssembly by YoWASP, a dev dependency) synthesizes a Verilog module in a script
(`read_verilog -specify`, `proc`, `flatten`, `opt -keepdc`) to its JSON netlist; a pure converter
in `src/library/hdl/` turns that into the IR — ports, signals, word-level cells, 4-state
constants, specify paths; a generic behavior interprets it: combinational cells in topological
order at zero delay inside one `evaluate`, flip-flops and latches on the kernel's strict edges
(an edge from `X`/`Z` makes the stored bits `X`), values as value/unknown bit planes in typed
arrays; the module's ports become pins, driven with its simple path delays
(`(A => Y) = (tPLH, tPHL)`). A library part is a module plus its data sheet metadata (pinout,
pin descriptions, function table). Proof: a 74HC00 written in Verilog passes the hand-written
74HC00's function table and timing tests; a counter and a state machine; a benchmark against the
hand-written chip. How the IR handles combinational loops, and whether library modules are
compiled at build time or committed as IR, are decided in its plan; the ADR is accepted here
after the benchmark.

## HDL-2 · Timing from specify blocks — `feat/hdl-timing`

The rest of a `specify` block: edge-sensitive paths (`(posedge CP => (Q +: D)) = …`),
conditional paths (`if (…)`), `min:typ:max` triples as the part's `timing` (typical, max, min),
and the timing checks `$setup`, `$hold`, `$setuphold`, `$width`, `$recovery`, `$period` mapped to
the kernel's `TimingChecks` ([ADR-0014](../adr/0014-timing-checks.md)) — the same diagnostics on
the same pins, the bits that may have loaded made `X`. Proof: a 74HC74 and a 74HC574 in Verilog
pass the hand-written ones' tests, timing checks included.

## HDL-3 · Verilog in the document — `feat/hdl-editor`

The user writes modules in the app: Verilog sources in the document, as test bench scripts are
([ADR-0025](../adr/0025-test-benches.md)), edited in CodeMirror with Verilog highlighting; Yosys
in a Web Worker, loaded only when a document has a module; errors and warnings at their source
lines; a module becomes a part placed like a subcircuit — pins from its ports, a generated
symbol; editing the source recompiles and carries the running simulation over. Whether the
compiled IR is kept in the document (so a document opens, and `pnpm test:circuits` runs it,
without Yosys) is decided in its plan. Example: a 6502 system's address decoder in Verilog with
its test bench.

## HDL-4 · Inside a module — `feat/hdl-inspection`

Signals and registers inside a module instance, by their source names (`state`, `count[3:0]`,
kept through synthesis): probes on them in the waveforms ([ADR-0019](../adr/0019-waveforms.md)),
watches and breakpoint conditions ([ADR-0020](../adr/0020-debugger.md)), reads from test
benches — debugging a state machine without bringing its state out to pins.

## HDL-5 · Programmable devices — `feat/pld-devices`

Real devices that hold a module, as parts with a package and a data sheet: an ATF22V10 (GAL) and
an ATF1504 (CPLD) first — the address decoders and glue logic of homebrew computers — then a
small FPGA (iCE40). A device's design is a module of the document with a pin assignment; its
timing is the device's pin to pin timing by speed grade (`tPD`, `tCO`, `tSU`, `tH`), not the
module's `specify`; the module's ports must fit the device's pins.

## HDL-6 · Memories in modules — `feat/hdl-memories`

Yosys memories in the IR: register files and block RAMs, synchronous and asynchronous read
ports, initial contents from `initial` blocks and `$readmemh` (a file in the document); an
instance's memories in the memory inspector through the part's `memory` view
([ADR-0018](../adr/0018-memory-inspector.md)).

## HDL-7 · PicoRV32 soft core — `example/picorv32`

PicoRV32 (ISC license, its upstream source) as a module in an example: the core with its memory,
running a program that writes to an output port, verified by a test bench; the program built
outside the app and kept as a hex image. Measures how fast a core of a few thousand cells runs:
if too slow for real programs, a faster evaluation (Ideas) becomes the next item.

## Ideas

Not scheduled yet; promoting one gives it the next free id and a row in the table.

- GAL and CPLD from JEDEC fuse maps (the track's first idea): read the `.jed` file WinCUPL or
  galasm produce into the same IR, so a GAL is simulated from the very file burned into it.
- Fitting checks: whether a design fits its device — product terms per GAL output, CPLD
  macrocells, FPGA LUTs (Yosys `synth_ice40` and `stat`) — as design checks.
- Faster evaluation: the IR compiled to JavaScript functions or to WebAssembly, if HDL-7 shows
  the interpreter too slow for real programs.
- Library controllers in Verilog: the W65C22 VIA or the 6551 ACIA (R18) written as modules with
  a `specify` block instead of TypeScript; needs HDL-2.
- Cross-checking against a Verilog simulator: export a module and its test bench's stimulus as a
  Verilog testbench for Icarus or Verilator, and compare the outputs (where the source doesn't
  rely on `X`).
- SystemVerilog beyond the subset Yosys reads (yosys-slang).
- VHDL through GHDL — written in Ada, hard to run in a browser; only if needed.
