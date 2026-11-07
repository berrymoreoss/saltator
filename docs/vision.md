# Vision

## One sentence

A browser-based digital logic simulator in which you can design, run, debug and **verify** a
small computer built from real chips (74HC series first, then memories, CPUs and peripherals)
before you build it for real: **test before fab**.

## Why

Breadboard computers (Ben Eater's SAP-1 and 6502 builds, and more ambitious designs) are a great
way to learn digital electronics, but debugging on real hardware is slow and opaque. Classic
tools leave a gap:

- **Logisim**-style simulators are great for learning logic but abstract away real parts:
  pinouts, propagation delays, tri-state buses, floating inputs, bus contention.
- **Proteus**-style tools model real parts but are heavy, proprietary and not built for
  learning or for inspecting the inside of a running computer.

This project sits in between: the immediacy of Logisim, the realism of Proteus where it matters
for digital builds, and first-class tools for looking inside memories and buses.

## Goals

1. **Real parts.** Components are real chips with real part numbers, pinouts and datasheet
   timing. A schematic in the simulator maps 1:1 to a breadboard or PCB.
2. **Faithful digital behavior.** Event-driven simulation with propagation delays, 4-state logic
   (0, 1, X, Z), drive strengths (pull-ups/downs), bus contention and floating-input detection:
   the bugs you would hit on a breadboard show up in the simulator.
3. **See inside.** Live signal coloring, LEDs and displays, memory inspectors (view, edit, flash
   ROM/RAM), logic analyzer with waveforms, breakpoints and single-stepping.
4. **Verify.** Automated test benches and test vectors for your own circuits, runnable in the app
   and headless, so a design can be proven before parts are ordered.
5. **Grow with the learner.** From a single gate to a full 8-bit computer with a 16-bit address
   bus: 74HC logic, then ROM/RAM, then CPUs (6502 first; AVR, PIC, Z80 later) and peripherals
   (LCD, VIA, serial, buzzer).

## Milestones that define success

- **M1 "Hello, LED"**: switch → 74HC00 → LED and a blinking clock, built in the browser.
- **M2 "Modules"**: SAP-1 building blocks (clock, registers, ALU, counter, RAM, output display)
  work in isolation.
- **M3 "SAP-1 runs"**: Ben Eater's 8-bit breadboard computer runs a program, verified by a test
  bench.
- **M4 "6502 Hello World"**: a 6502 computer (65C02 + 28C256 + 62256 + 65C22 + HD44780) prints to
  its LCD from code assembled in the app.
- **M5 "My computer"**: the author's own 8-bit computer with a 16-bit address bus is designed and
  verified in the simulator, then built.

Details and ordering: [roadmap.md](roadmap.md).

## Non-goals (for now)

- Analog simulation (SPICE). Analog-ish parts appear only as digital behavioral models (e.g. a
  555 as a clock source, a buzzer as a tone output).
- PCB layout and routing. Netlist/BOM export may come later.
- Multi-user collaboration and cloud accounts.
- Gate-level timing analysis beyond what datasheet delays and setup/hold checks provide.

## Principles

- **Fidelity where it changes outcomes, simplicity elsewhere.** Model what breaks real builds
  (timing, buses, floating inputs); don't model what doesn't (exact analog thresholds).
- **Determinism.** The same circuit with the same stimulus always produces the same result.
  Bugs are reproducible, tests are reliable.
- **Headless first.** The simulation kernel and component library run without a UI, so they are
  testable and can move to a Web Worker.
- **Datasheet as the source of truth.** Every part cites its datasheet; its tests are built from
  the datasheet function table.
- **Small steps.** Each feature lands in its own branch with its own plan; main always works.
