# Programmable logic

Track `HDL` of the [roadmap](../roadmap.md).

**Goal:** logic written instead of wired. The user writes a module in Verilog — an address
decoder, glue logic — instead of building it from a handful of 74HC chips, places it in the
circuit as a part, tests it, and takes the same source to the FPGA or CPLD they will build with.
From there the same pipeline grows until it runs anything synthesizable: controllers on a bus,
memory, video and sound controllers, soft cores up to a PicoRV32 at a usable speed, library parts
written in Verilog with their data sheet timing, and the programmable devices themselves (GAL,
CPLD, FPGA) as parts. One pipeline throughout ([ADR-0030](../adr/0030-hdl-modules.md)): Yosys
synthesizes the source, its netlist becomes an IR (plain data), and one interpreter in the
library runs it as an ordinary part, with pin delays, snapshots and test benches like every
other part.

**Not here:** hand-written parts ([Parts](parts.md)); whether the 6502's peripherals (R18,
[MOS 6502](mos6502.md)) are written in Verilog, decided when R18 starts; general tools the
modules use (waveforms, debugger, test benches — [Platform](platform.md)); the parts video and
sound controllers drive (a VGA monitor — the "Video output" track idea; the buzzer — R18).

## Items

| ID     | Branch                | Title                           | Needs | Status  |
| ------ | --------------------- | ------------------------------- | ----- | ------- |
| HDL-1  | `feat/hdl-modules`    | Verilog modules in the document | —     | next    |
| HDL-8  | `feat/hdl-bus`        | Modules on a bus                | —     | planned |
| HDL-9  | `feat/hdl-semantics`  | All of synthesizable Verilog    | —     | planned |
| HDL-3  | `feat/hdl-projects`   | Verilog projects                | —     | planned |
| HDL-4  | `feat/hdl-inspection` | Inside a module                 | —     | planned |
| HDL-6  | `feat/hdl-memories`   | Memories in modules             | —     | planned |
| HDL-7  | `example/picorv32`    | PicoRV32 soft core              | —     | planned |
| HDL-10 | `feat/hdl-fast`       | Fast evaluation                 | —     | planned |
| HDL-2  | `feat/hdl-library`    | Library parts in Verilog        | —     | planned |
| HDL-5  | `feat/pld-devices`    | Programmable devices            | —     | planned |

## HDL-1 · Verilog modules in the document — `feat/hdl-modules`

_Re-scoped on 2026-11-09 ([plan](../../.ai/plans/docs-hdl-roadmap.md)): the user's own module
comes first, so this item took the editor and the module as a part from HDL-3, and gave the
library parts, the 74HC00 proof and `specify` timing to HDL-2._

The smallest pipeline of [ADR-0030](../adr/0030-hdl-modules.md) that lets the user write a
decoder and run it. Yosys (packaged for WebAssembly by YoWASP) in a Web Worker, loaded only when
a document has a module, synthesizes it (`read_verilog`, `hierarchy -top`, `proc`, `flatten`,
`opt -keepdc`) to its JSON netlist; a pure converter in `src/library/hdl/` turns that into the
IR — ports, signals, word-level cells, 4-state constants; a generic behavior interprets it:
combinational cells in topological order at zero delay inside one `evaluate`, flip-flops and
latches on the kernel's strict edges (an edge from `X`/`Z` makes the stored bits `X`), values as
value/unknown bit planes in typed arrays.

The cells a decoder, a counter or a state machine needs: bitwise and reduction logic,
comparisons, `$mux`/`$pmux`, `+`/`−`, shifts, flip-flops with and without enable and
(a)synchronous reset, latches. Anything else — memories, combinational loops, cells HDL-9 adds —
is refused with an error at its source line.

The module's ports become the pins of a generated symbol, placed like a subcircuit (how a
vector port meets a bus — a bus pin as on subcircuits or a pin per bit — is decided in its plan);
its outputs are driven with one delay, a property of the part, as there is no `specify` timing
yet. The source lives in the document as test bench scripts do
([ADR-0025](../adr/0025-test-benches.md)), edited in CodeMirror with Verilog highlighting, with
Yosys's errors and warnings (an inferred latch among them) at their lines; editing it recompiles
and restarts the simulation; it downloads as a `.v` file for the FPGA's tools. Whether the
compiled IR is kept in the document (so a document opens, and `pnpm test:circuits` runs it,
without Yosys) is decided in its plan.

Proof: an example — the address decoder of a 6502 system's memory map in Verilog with its test
bench, passing in the app and headless; a counter and a state machine; a benchmark of the
interpreter as the baseline for HDL-10. ADR-0030 is accepted here.

## HDL-8 · Modules on a bus — `feat/hdl-bus`

Modules that share a bus with other parts: tri-state outputs (`assign d = oe ? q : 8'bz`) become
drivers that release their pins (`Z`), `inout` ports `bidir` pins the module reads back, an input
at `Z` reads as `X`. Yosys keeps the `z` through optimization as `$tribuf` cells (`tribuf`);
tri-states inside a module become logic (`tribuf -logic`). Taking and releasing the bus use the
module's delay until HDL-2 brings per-path timing. Proof: an I/O port on a data bus, written and
read through it by a test bench; two drivers at once reported as `contention`.

## HDL-9 · All of synthesizable Verilog — `feat/hdl-semantics`

Every cell `proc` and `opt` leave in a netlist, so a design from elsewhere runs as written: the
rest of the arithmetic (`$mul`, `$div`, `$mod`, `$divfloor`, `$modfloor`, `$pow`), signed
operands, `$shift`/`$shiftx`, `$bmux`/`$demux`/`$bwmux`, `$eqx`/`$nex`, every flip-flop and latch
flavour (`$dffsr`, `$aldff`, `$sr`, `$dlatchsr`, …); values wider than 32 bits in multi-word bit
planes (a 64-bit counter, a 32 × 32 multiplier); flip-flops clocked from inside the module (a
clock divider, a derived clock — combinational and sequential steps repeated within one
`evaluate` until nothing changes); combinational loops iterated to a fixed point, `X` and a
diagnostic if they don't settle; power-up values from `init` (`reg q = 0`, as an FPGA loads its
flip-flops), `X` without one. Proof: differential tests — random expressions and small designs
run by the interpreter and by Yosys's own `sim`/`eval` on the same netlist, compared where no `X`
is involved; a UART transmitter and receiver as an example.

## HDL-3 · Verilog projects — `feat/hdl-projects`

_Re-scoped on 2026-11-09 ([plan](../../.ai/plans/docs-hdl-roadmap.md)): its first part — a
module's source in the document, the editor, the module as a part — went to HDL-1; this item is
the rest, what real projects need._

Designs as they come from elsewhere: a module's sources as several files, `` `include `` and
`` `define ``, the top module chosen; parameters set per placed instance (`#(.WIDTH(8))` as a part
property, each parameter set synthesized once); the SystemVerilog Yosys reads
(`read_verilog -sv`: `logic`, `always_ff`, `always_comb`); editing a source carries the running
simulation over (state matched by signal name); a project downloads as its files. Example: an
open-source design opened as is.

## HDL-4 · Inside a module — `feat/hdl-inspection`

Signals and registers inside a module instance, by their source names (`state`, `count[3:0]`,
kept through synthesis): probes on them in the waveforms ([ADR-0019](../adr/0019-waveforms.md)),
watches and breakpoint conditions ([ADR-0020](../adr/0020-debugger.md)), reads from test
benches — debugging a state machine without bringing its state out to pins.

## HDL-6 · Memories in modules — `feat/hdl-memories`

Yosys memories in the IR: register files and block RAMs, synchronous and asynchronous read
ports, initial contents from `initial` blocks and `$readmemh` (a file in the document); an
instance's memories in the memory inspector through the part's `memory` view
([ADR-0018](../adr/0018-memory-inspector.md)). Proof: a FIFO, a register file, a character ROM
loaded with `$readmemh`.

## HDL-7 · PicoRV32 soft core — `example/picorv32`

PicoRV32 (ISC license, its upstream source) as a module in an example: the core with its memory,
running a program that writes to an output port, verified by a test bench; the program built
outside the app and kept as a hex image. Measures how fast a core of a few thousand cells runs
against HDL-1's baseline — the target HDL-10 is held to.

## HDL-10 · Fast evaluation — `feat/hdl-fast`

_Promoted from the track's ideas on 2026-11-09 ([plan](../../.ai/plans/docs-hdl-roadmap.md)):
soft cores and video controllers are the track's goal, not a possibility._

Speed for cores and video: only the cells downstream of what changed are evaluated, 32 bits at a
time where no bit is `X`, and the IR is compiled once per module — to JavaScript functions or to
WebAssembly, decided in its plan with the test bench sandbox
([ADR-0026](../adr/0026-test-bench-sandbox.md)) in mind, since a document's module is code from a
shared file. The target is set from HDL-7's measurement: PicoRV32 running real programs, and a
video controller's pixel clock within reach. Proof: HDL-7's example and benchmark, the same
results at the target speed.

## HDL-2 · Library parts in Verilog — `feat/hdl-library`

_Re-scoped on 2026-11-09 ([plan](../../.ai/plans/docs-hdl-roadmap.md)): took the library parts
and the 74HC00 proof from HDL-1._

Chips of the library written in Verilog with their data sheet timing, so controllers (a VIA, an
ACIA, a video or sound chip) can be modules instead of TypeScript. A library part is a module
plus its data sheet metadata (pinout, pin descriptions, function table), compiled ahead of time
— at build time or committed as IR, decided in its plan — so running it never needs Yosys. Its
timing comes from the module's `specify` block (`read_verilog -specify`): simple paths
(`(A => Y) = (tPLH, tPHL)`), edge-sensitive paths (`(posedge CP => (Q +: D)) = …`), conditional
paths (`if (…)`), transitions to and from `Z` (`tPZH`, `tPHZ`, …), `min:typ:max` triples as the
part's `timing` (typical, max, min), and the timing checks `$setup`, `$hold`, `$setuphold`,
`$width`, `$recovery`, `$period` mapped to the kernel's `TimingChecks`
([ADR-0014](../adr/0014-timing-checks.md)) — the same diagnostics on the same pins, the bits that
may have loaded made `X`. Proof: a 74HC00, a 74HC74 and a 74HC574 in Verilog pass the
hand-written ones' function table and timing tests, timing checks included; a benchmark against
the hand-written 74HC00.

## HDL-5 · Programmable devices — `feat/pld-devices`

Real devices that hold a module, as parts with a package and a data sheet: an ATF22V10 (GAL) and
an ATF1504 (CPLD) first — 5 V parts for the address decoders and glue logic of homebrew
computers — then a small FPGA (iCE40, 3.3 V). A device's design is a module of the document with
a pin assignment, exported for the device's tools (a `.pcf` for nextpnr); its timing is the
device's pin to pin timing by speed grade (`tPD`, `tCO`, `tSU`, `tH`), not the module's
`specify`; the module's ports must fit the device's pins.

## Ideas

Not scheduled yet; promoting one gives it the next free id and a row in the table.

- GAL and CPLD from JEDEC fuse maps (the track's first idea): read the `.jed` file WinCUPL or
  galasm produce into the same IR, so a GAL is simulated from the very file burned into it.
- Fitting checks: whether a design fits its device — product terms per GAL output, CPLD
  macrocells, FPGA LUTs (Yosys `synth_ice40` and `stat`) — as design checks.
- Voltage checks: a 5 V output on the pin of a 3.3 V device that doesn't tolerate it (an iCE40
  next to a 5 V 6502) as a design check; needs supply voltages in the part model.
- Video controllers in Verilog: a VGA text or graphics controller driving a monitor part; needs
  the "Video output" track and HDL-10.
- Sound in Verilog: a tone or PSG-style generator driving the buzzer (R18) or an audio DAC part.
- Memory controllers in Verilog: DRAM refresh, an SDRAM controller; needs the DRAM or SDRAM part
  ([Parts](parts.md)).
- Library controllers in Verilog: the W65C22 VIA or the 6551 ACIA (R18) written as modules with
  a `specify` block instead of TypeScript; needs HDL-2.
- Messages and assertions from a module: Yosys turns `$display` in an `always` block into `$print`
  cells and immediate assertions into `$check` cells — lines in the simulator's log and
  diagnostics.
- FPGA primitives: simulation models of the iCE40's `SB_IO`, `SB_RAM40_4K`, `SB_PLL40_CORE`
  (a PLL as a clock part), so a design that instantiates them runs; after HDL-5.
- Cross-checking against a Verilog simulator: export a module and its test bench's stimulus as a
  Verilog testbench for Icarus or Verilator, and compare the outputs (where the source doesn't
  rely on `X`).
- SystemVerilog beyond the subset Yosys reads (yosys-slang).
- VHDL through GHDL — written in Ada, hard to run in a browser; only if needed.
