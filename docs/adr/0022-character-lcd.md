# 0022. Character LCD: one HD44780 module part, the controller at instruction level, unknowns merged

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** — (off the roadmap, ahead of R18; branch `feat/lcd-hd44780`)

## Context

The character LCD with a Hitachi HD44780U controller is the display of nearly every hobby
computer: Ben Eater's 6502 prints its "Hello, world!" on one (R20), the author's own computer
(M5) will too. It is the first part with a real controller inside: internal RAM, a busy
period after each instruction, two bus widths, a power-on reset that may or may not work. Forces:

- **Test before fab**: on the bench an LCD fails quietly — a character sent while it is busy is
  lost, a 4-bit interface out of step prints garbage after a CPU reset, a program that relies on
  the internal reset works until the supply rises slowly. The simulator should say so.
- Modules come in many sizes (8 × 1 to 40 × 2) with the same controller; the glass is wired to
  its two lines of 40 characters in different ways (a 20 × 4's line 3 continues line 1).
- The data sheet gives limits only (bus timing min/max, execution times "max at 270 kHz"), its
  character ROMs as a picture (Table 4), and a few figures where the text is blank (Clear
  display's execution time) or contradicts itself (`tADD`: 4 µs in Table 6, 1.5 / f in
  Figure 10).
- The kernel is 4-state and reports what is uncertain as `X` (ADR-0014); a controller's state
  (registers, 80 + 64 bytes of RAM, the interface mode) has to follow that without exploding.
- The schematic should show what the glass shows, like the LEDs and 7-segment displays do.

## Decision

- **One part, `periph/hd44780`**, the module with its 16-pin header (VSS, VDD, V0, RS, R/W̅, E,
  DB0–DB7, A, K; Newhaven NHD-0216K1Z pinout). Props: `size` (13 sizes, the glass wiring as
  data: each glass character's controller line and segment column), `backlight` (6 glass
  colors), `rom` (A00, A02), `oscillator` (190–350 kHz: execution times scale by 270 kHz / f),
  `powerOn`. The pins sit along the bottom at offsets 1–16 whatever the size, so resizing never
  moves a wire.
- **The controller at instruction level**, not at its COM/SEG outputs: Table 6's instructions
  take effect when the transfer completes; BF stays 1 for the execution time (Clear display
  1.52 ms, as module data sheets give it); the address a busy-flag read shows lags until `tADD`
  (1.5 / f, the longer of the two); 8- and 4-bit transfers with the nibble phase as state (a CPU
  reset mid-byte leaves the module out of step, as on the bench); internal pull-ups on DB0–DB7
  (weak 1 while not driving), RS and R/W̅ (floating reads HIGH).
- **The bus timing as timing checks** (`tcycE`, `PWEH`, `tAS`, `tAH`, `tDSW`, `tH`; the cycle
  check is new in `core`), reads with an `X` window (`tDDR`, `tDHR`), and two requirements of
  the LCD's own: a write or data read while busy (`busy-violation`, not accepted) and a write
  less than 15 ms after power-on (`power-on-violation`). **Every `*-violation` kind is an
  error** (`diagnosticSeverity`), whichever part reports it. A transfer completes `tAH` = `tH`
  after E falls, so changes within the hold window still make it uncertain.
- **Unknowns by merging outcomes**: whatever is uncertain — RS or R/W̅ (a set-up violation),
  data bits, whether the transfer happened (an uncertain E, a maybe-busy controller), which
  interface mode it is in — is worked out by running every possible outcome exactly and merging
  them: registers that differ become unknown, cell bits that differ become `X`, busy is certain
  until the earliest deadline and possible until the latest. An instruction with at most 3
  unknown bits runs once per value; with more, "any instruction" marks everything it could
  touch (enumerating 2⁸ values in up to 24 outcomes per E edge ran out of memory). An uncertain
  E keeps the transfer open until E is known LOW again.
- **Power-on**: `reset` (default) is the data sheet's internal reset — busy 10 ms, then 8-bit,
  1 line, display off, increment — so Ben Eater's code works as on the bench; `unknown` is the
  reset that didn't happen: every register, every cell and the interface mode unknown until
  the initialization by instruction (Figures 23, 24) resolves them. Its waits follow from the
  execution times at the oscillator (a write while an unknown instruction may still run is a
  "may be busy" violation); the data sheet's 4.1 ms and 100 µs cover slower clocks.
- **The character ROMs come from the data sheet**: `scripts/extract-hd44780-font.ts` reads the
  dots off the vector Table 4 rendered as a PGM, into `hd44780-font.ts`; no third-party font.
- **The glass is drawn from a pure frame** (`hd44780Frame`: 8 rows of 5 dots per character,
  unknown characters marked) by the editor's `lcd` drawer; the backlight is an LED on A/K, the
  contrast input V0 shows the characters only when LOW. The blink follows simulated time; a
  definition's new `animation(state, props)` tells the host how long one look lasts, so it
  redraws a blinking cursor in an idle circuit.

## Consequences

- An LCD program is checked against the data sheet: timing, busy, the 15 ms wait, and with
  `powerOn: unknown` the robustness of its initialization. Running the examples showed such
  bugs on the way (a lost entry mode at a faster clock that left the text looking right).
- The merging approach is general — R17's CPU and R18's VIA can use it for their own unknown
  controls — but it multiplies: anything that enumerates must cap what it enumerates.
- `animation` and `*-violation` severity are small general mechanisms in `core`; `PartLive`
  gained `time`.
- Not modeled: analog contrast and backlight current, 5 × 10 glass (F = 1 shows the top 8 rows,
  with a warning), 40 × 4 modules (two controllers), the "N and F can't change after
  initialization" rule (clones allow it), the second line's contrast in 1-line mode.
- The design check still says an unconnected RS or R/W̅ "reads as X" though the pull-up makes
  it HIGH; an unconnected R/W̅ is a real mistake (the module drives the bus), so the warning
  stays.

## Alternatives considered

- **A part per size** (`periph/lcd-1602`, `periph/lcd-2004`) — more type ids for one controller;
  the glass wiring is data.
- **`io/lcd`** next to the 7-segment display — the controller makes it a peripheral; the docs
  had reserved `periph/hd44780` for R18.
- **Simulating COM/SEG drive and the LCD's response** — far below what a schematic designer
  needs, and the glass would flicker with the multiplexing.
- **Ignoring writes while busy silently, or applying them** — the first hides the bug, the
  second makes a broken program work; reported and not accepted is what the data sheet says.
- **A wholly unknown controller after any uncertainty** — simpler, but a single late RS bit
  would blank the display for good; merging keeps what all outcomes agree on (a late RS on a
  data write leaves the address known).
- **The internal reset only** (no `powerOn: unknown`) — the waits of the initialization by
  instruction would go unchecked; the user asked for both (Q1).
- **A third-party font table** (MIT-licensed emulator fonts) — exact but not from the data
  sheet; the vector table made extraction reliable.
