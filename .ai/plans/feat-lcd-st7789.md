# Plan: feat/lcd-st7789

| Field      | Value                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Branch     | `feat/lcd-st7789`                                                                                      |
| Roadmap    | LIB-2 — TFT LCD (ST7789), track [Parts](../../docs/roadmap/parts.md)                                   |
| Status     | done                                                                                                   |
| Depends on | LIB-1 (`periph` family, controller patterns, merging outcomes), R09a (timing checks), R14b (snapshots) |
| Created    | 2026-11-08                                                                                             |

## Goal

A color TFT module with the Sitronix **ST7789V** controller on its 4-line SPI: the 240 × 320,
240 × 240 and 135 × 240 IPS modules that hobby builds use. The part behaves like the real
module:

- The commands a driver sends take effect as the data sheet says: the window, the MADCTL
  directions, 12/16/18-bit color, inversion, sleep, display on/off, idle, partial mode and
  scrolling.
- The waits after a reset, `SWRESET` and `SLPOUT` and the SPI write timing are checked. A command
  sent too early is an error, and what it did becomes uncertain: the data sheet doesn't promise
  it works (Q5).
- The frame memory powers on unknown, as the data sheet says ("set randomly").

The schematic draws it as the module, with its glass showing the frame memory through the
panel's window. Most first-time bugs show on that glass: a missing `INVON`, BGR swapped, the
row offset a 240 × 240 panel needs when rotated. It is the second display after LIB-1. The
author's computer (M5) may use it, and a 6502 can drive it once the VIA lands (R18).

## Scope

**In scope**

- `library`: `periph/st7789`, the module with its pin header (Q4: which module):
  - The header pins: GND, VCC, SCL, SDA, RES, DC, CS and BLK.
  - One prop, `panel` (size, with its window in the frame memory as data). Every panel is a
    normally black IPS, so it needs `INVON` (task 1).
  - The controller at command level:
    - The 4-line serial interface I: CS framing, SDA sampled on SCL↑, D/CX on the 8th bit, and
      break and recovery as in §8.5.
    - The command decoder with every command's parameter count, and the registers with their
      H/W reset, S/W reset and power-on defaults.
    - The frame memory: 240 × 320 × 18 bits, plus an unknown flag per pixel.
    - The column and row counters, following MADCTL MX, MY and MV inside the CASET/RASET window.
    - `RAMWR` and `WRMEMC`, and COLMOD 12, 16 or 18 bits per pixel through RAMCTRL's EPF.
    - The display modes: on/off, sleep in/out, inversion, idle, partial, and vertical scrolling.
    - The panel-tuning commands (porch, gate, VCOM, power, gamma) are accepted and stored but
      have no visible effect.
- The SPI write timing as timing checks (Table 6). The reset pulse with its spike rejection
  (Table 9). The waits after RESX↑, `SWRESET`, `SLPOUT` and `SLPIN` as errors, with the command's
  effect uncertain (Q5).
- Unknowns, as ADR-0014 and ADR-0022 handle them:
  - An `X` bit makes the pixel or register it lands in unknown.
  - An uncertain D/CX or command byte runs each outcome and merges them, up to a cap.
  - A lost bit phase leaves the interface out of step until CS↑ or a reset.
- A pure frame function: the visible glass as RGBA, with the display modes and the panel's
  window applied. The drawer and the tests both use it.
- `editor`: an `image` primitive in `SymbolGraphics` (canvas and recording) and a `tft` drawer:
  the module board, the bezel and the glass, with the backlight read from BLK. The frame is
  cached by a state version and dropped on every restore.
- Examples (Q3), scenario tests (a common initialization written from the data sheet, then
  drawing), the carry-over and rewind properties with the TFT, and a benchmark of an SPI stream.
- Docs: components.md, editor.md, glossary, ADR-0031, the roadmap section, READMEs, lessons.

**Out of scope** (and where it goes instead)

- The 8080 parallel interfaces, the 3-line 9-bit serial, the 2-data-lane serial and the
  RGB/VSYNC interfaces → Parts ideas, unless Q1 brings 8080 8-bit in.
- Reads (`RDDID`, `RDDST`, `RDID1`–`3`, `RAMRD`…), where SDA turns around: a read command is
  reported as a warning (`read-not-simulated`, Q2) → Parts ideas.
- No visible effect, so not simulated:
  - the TE output, CABC and brightness (`51h`–`5Fh` drive LEDPWM, which no module brings out);
  - gamma curves, frame rate and porches;
  - NVM programming;
  - the panel's refresh scan and tearing: the glass shows the frame memory at once;
  - LCD response time.
- Voltage: the ST7789V is a 3.3 V part (VDDI ≤ 3.3 V) and its inputs aren't 5 V tolerant. The
  simulator has no voltage domains, so the Part tab says this in prose. A voltage-domain check
  and level-shifter parts → Parts ideas.
- Showing the frame memory in the Memory tab → the existing LIB-1 idea (a `MemoryDef` without
  address pins).
- Pixel assertions in test benches → Platform ideas.
- Other TFT controllers (ILI9341, ST7735, GC9A01, ILI9488) → Parts ideas.
- `powerOn: unknown` (RESX not held stable during power-on, so the registers are unknown until
  a reset) → Parts ideas.
- A 6502 driving it → R18 (the VIA), then the MOS track.

## Context

Read before starting:

- [ADR-0022](../../docs/adr/0022-character-lcd.md) and `src/library/periph/hd44780*.ts`: the
  module-as-a-part shape, completing a transfer, merging outcomes, `*-violation` errors, a pure
  frame read by a drawer.
- [ADR-0014](../../docs/adr/0014-timing-checks.md) and `src/core/timing-checks.ts`:
  `setupHold`, `pulseWidth` and `cycle` with `armed`. D/CX is checked only on the 8th edge.
- [ADR-0021](../../docs/adr/0021-rewind.md): state as plain data, typed arrays shared in 4 KiB
  pages, restored into the live objects. This matters for the drawer's cache.
- `src/editor/graphics.ts` (`SymbolGraphics`, `CanvasGraphics`),
  `src/editor/recording-graphics.ts`, `src/editor/symbols/lcd.ts` and `types.ts` (`PartLive`).
- `tests/scenarios/lcd-program.ts`, `lcd.test.ts`, `carry-over.test.ts`, `rewind.test.ts`, and
  `tests/bench/`.
- Data sheets, with copies in the session scratchpad `ds-st7789/` (re-download if it is gone):
  - Sitronix **ST7789V** V1.3 (2014/03), from
    newhavendisplay.com/appnotes/datasheets/LCDs/ST7789V.pdf. This is the base.
  - Sitronix ST7789VW V1.0 (2017), from rhydolabz.com/documents/33/ST7789.pdf. Used to note
    the differences.
  - QT154H2201, the 1.54" 240 × 240 panel (Adafruit 3787). It shows the bare panel's IM, 8080
    and SPI pins.

## Design

### The part

`periph/st7789`: name `ST7789`, title "TFT LCD module (ST7789)", designator `DS`. Keywords:
`tft`, `lcd`, `st7789`, `ips`, `spi`, `color display`, `240x240`, `240x320`. There is one part
for every panel, because the controller is the same and only the glass and its window differ
(as with LIB-1's sizes).

Pins: the common 8-pin breakout header (Q4). Task 1 pins down the order and the BLK circuit
from a module data sheet.

| Pin | Dir       | What                                                                       |
| --- | --------- | -------------------------------------------------------------------------- |
| GND | power     | not simulated                                                              |
| VCC | power     | not simulated                                                              |
| SCL | in        | serial clock: SDA is sampled on its rising edge (ignored while CS is HIGH) |
| SDA | in        | serial data, MSB first (Q2: reads would make it bidirectional)             |
| RES | in        | RESX: a LOW pulse ≥ 10 µs resets; < 5 µs is rejected; 5–9 µs is uncertain  |
| DC  | in        | D/CX, sampled on the 8th rising edge: 0 command, 1 parameter or pixel data |
| CS  | in        | CSX: its falling edge starts a byte; HIGH resets the bit phase             |
| BLK | in, sense | backlight: lit while HIGH or floating (10 kΩ pull-up), dark while LOW      |

A module without CS (the 7-pin 1.3" boards) is this part with CS tied to GND.

Props: one, `panel`. Each panel is data: its glass size and its window in the physical
frame memory.

| `panel`             | Module (source)       | Window (columns × rows) |
| ------------------- | --------------------- | ----------------------- |
| `240x320` (default) | 2.0", MSP2008         | 0–239 × 0–319           |
| `240x240`           | 1.3", MSP1308 (7-pin) | 0–239 × 0–239           |
| `135x240`           | 1.14", MSP1141        | 52–186 × 40–279         |

The vendor offsets in task 1 confirm every window. Other sizes (170 × 320, 172 × 320,
240 × 280) had no module data sheet, so they are left out. All three panels are "normally
black" IPS. Every vendor initialization sends `INVON` and then expects 0xFFFF to show white,
so the glass shows the frame memory's colors inverted unless inversion is on. With that
evidence, the panel needs no `glass` or `order` prop: no TN or BGR-wired module has a source,
and MADCTL's RGB bit alone swaps R and B. The offsets a rotated panel needs fall out of the
model with no special case: MY = 1 writes MCU row 0 to physical row 319, which is off a
240 × 240 glass.

### The controller

- **Serial interface (§8.4):** while CS is HIGH, nothing happens. Once CS falls, each SCL↑
  shifts SDA in. On the 8th edge D/CX is sampled and the byte completes. A CS↑ before D0
  rejects the partial byte, and the bytes already received stand (§8.5, Figures 20–21).
- **Commands:** a table of code → parameter count → handler. A code the data sheet doesn't
  define (e.g. `D6h`, which MSP1141's initialization sends) is a warning (`unknown-command`):
  it is ignored with the parameters that follow it. Parameters arrive with D/CX = 1
  after their command. A new command cancels an unfinished one and keeps the parameters that
  were already sent. `RAMWR` resets the counters to the window start. `WRMEMC` continues where
  they are. Data after `RAMWR` writes pixels until the next command.
- **Frame memory:** a `Uint32Array(240 × 320)` with 18 bits of color (R6 G6 B6) and an unknown
  bit. That is 300 KiB, shared in 4 KiB pages between snapshots. A full-screen fill spreads
  over many checkpoints, so each checkpoint stores only the pages it touched.
- **Address counters (§8.12):** the logical (column, row) goes through MV (swap), MX and MY
  (mirror) to physical. Within the window the column increments and wraps to the next row; at
  the end of the window everything wraps to the start. Out-of-range data is ignored (CASET
  restriction).
- **Color (§8.8.40–43, RAMCTRL):**
  - 12-bit: 3 bytes for 2 pixels. The data sheet draws a "look-up table for 4096 color data
    mapping" but never gives it: a data sheet blank. Each 4-bit channel takes the top 4 bits
    and its two MSBs repeat into the low 2. Documented as our choice.
  - 16-bit: 2 bytes per pixel. G6 is taken as is. R0 and B0 come from EPF (RAMCTRL, p. 259):
    00 → 0, 01 → 1, 10 → each channel's MSB, 11 (the default, F0h) → G0.
  - 18-bit: 3 bytes, the top 6 bits of each.
  - MADCTL RGB swaps R and B where the driver's outputs meet the panel (the MADCTL figure
    draws it there), so the frame applies it at display time: toggling it swaps what is shown.
- **Display modes**, applied by the frame function and never to the memory:
  - `DISPOFF` and sleep-in show a blank page (black on IPS);
  - `INVON` XORs the color;
  - idle keeps the top bit of each channel (8 colors);
  - partial mode blanks the rows outside `PTLAR`;
  - `VSCRDEF`/`VSCSAD` roll the scroll area (TFA + VSA + BFA = 320, otherwise undefined: shown
    as unknown).
- **Reset:** the H/W reset (RESX) and `SWRESET` set the registers to their columns in each
  command's "Default" table: sleep in, display off, normal mode, inversion off, COLMOD 06h,
  MADCTL 00h, window 0–239 × 0–319 (COLMOD 06h, MADCTL 00h are "No change" at `SWRESET`). The frame memory is not cleared ("not cleared"). At power-on
  the registers take their power-on defaults and the frame memory is unknown ("set randomly").

### Timing (Table 6, write; Table 9; command restrictions)

These are timing checks against the minima (Table 6, VDDI 1.65–3.3 V):

| Check         | Spec                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `tCSS`        | 15 ns, CS↓ → first SCL↑                                                    |
| `tCSH`        | 15 ns, last SCL↑ → CS↑                                                     |
| `tCHW`        | 40 ns, CS HIGH                                                             |
| `tSCYCW`      | 66 ns                                                                      |
| `tSHW`        | 15 ns                                                                      |
| `tSLW`        | 15 ns                                                                      |
| `tSDS`/`tSDH` | 10 ns each                                                                 |
| `tDCS`/`tDCH` | 10 ns each, `armed` on the 8th edge only                                   |
| `tRW`         | RESX LOW ≥ 10 µs (< 5 µs rejected silently, 5–9 µs reported and uncertain) |

Waits after a command (Q5): anything sent sooner is a `*-violation` error (`wait-violation`),
and its effect is **uncertain**. The data sheet says "it will be necessary to wait" but not what
happens otherwise, and vendor code that skips the waits works on the bench. So both outcomes,
applied and not applied, are merged (ADR-0014):

- a register or mode it sets becomes unknown where the two outcomes differ;
- pixel data that may not have been written makes the target pixels unknown where old and new
  differ;
- an early `SWRESET` makes every register it resets unknown.

The frame then has three kinds of pixel:

- **known**;
- **uncertain**: the memory color is known but how it shows is not, because display on, sleep,
  inversion or idle is unknown. It is drawn as its color under the `X` veil, so the picture
  stays visible but is marked;
- **unknown**: the memory is `X`, drawn as noise.

A later command sent in time resolves the mode again.

| After     | Wait                                                         |
| --------- | ------------------------------------------------------------ |
| RESX↑     | 5 ms before any command; 120 ms before `SLPOUT`              |
| `SWRESET` | 5 ms before any command; in sleep-in, 120 ms before `SLPOUT` |
| `SLPOUT`  | 5 ms before the next command; 120 ms before `SLPIN`          |
| `SLPIN`   | 5 ms before the next command                                 |

### Unknowns

- An `X` on SDA at a sampled edge makes that bit unknown. In pixel data it marks the pixel
  unknown; in a parameter it makes the register unknown.
- D/CX is uncertain on the 8th edge: two outcomes, the byte as a command and as data, merged.
- The command code has unknown bits: at most 3 run every value and merge the registers. With
  more it counts as "any command": every register is unknown and the write state is unknown.
- The window is unknown when pixel data arrives: the pixels it could reach become unknown
  (possibly the whole memory).
- An unknown SCL edge, or CS uncertain: the bit phase is unknown and the interface is lost
  until CS↑ or a reset. While lost, bytes count as "any byte".
- An uncertain reset pulse (5–9 µs, or `X` on RES): merge reset and no reset.

### Frame and drawer

- `st7789Frame(state, props)` is pure (library). It returns the glass's width, height, RGBA
  (`Uint8ClampedArray`), and the state's version (a counter that every visible change bumps).
  Unknown pixels get a deterministic noise in the `X` tint, close to what power-on garbage
  looks like on the bench, but unmistakably unknown.
- `SymbolGraphics.image(pixels, box)`:
  - `CanvasGraphics` blits it through an offscreen canvas kept per image source. Nearest-neighbor
    once a pixel is ≥ 1 screen pixel; smoothed when zoomed out. It follows the part's placement
    (rotation, mirroring).
  - `RecordingGraphics` records the size, the box and a checksum.
- The `tft` drawer draws the board, the bezel and the glass: 1 glass pixel = 1/16 cell, so one
  CSS pixel per glass pixel at 100 % and a 240 × 320 glass is 15 × 20 cells. The pins sit along
  the bottom at fixed offsets whatever the panel. The backlight: BLK LOW shows a dark glass and
  `X` shows the `X` tint. The frame is cached by (part, version) and the editor drops the cache
  on every restore, because a restored counter could repeat on another timeline.
- Budget: an unchanged redraw ≤ 0.5 ms, a changed frame ≤ 3 ms (headless Chromium, M3 Pro).

### Speed (not this part's problem, but the plan should say it)

A full 240 × 240 frame at 16 bpp is about 0.92 M SPI bits. The part costs one evaluation per
edge, so the circuit driving it sets the speed. The benchmark measures a counter + ROM + 74HC165
stream with and without the TFT. A 6502 bit-banging at 1 MHz needs about 18 s per frame on real
hardware, and the simulator shows that honestly.

### The example: TFT Color Bars (Q3)

SMPTE color bars (EG 1-1990 layout; RGB values of the Wikimedia rendition) on a 240 × 320 in
landscape (MADCTL 60h, the module turned 90° counterclockwise on the schematic), streamed from
two EEPROMs at 500 kHz. As built (`examples/tft-color-bars.logic.json`, program in
`tests/scenarios/tft-program.ts`):

- **Counting:** U1 and U2 74HC4040 count CLK's falling edges (b0–b23, RESET on MR). A byte is
  b3 and up.
- **Pixel EEPROM** U3 AT28C256: A0–A9 = b3–b12, A10–A14 = b16–b20. CASET 0–511 makes a row
  1024 bytes, because the columns past 319 are ignored but still counted, so every row of a
  block of 8 reads the same 1 KB. Blocks 1–30 are rows 0–239 (band edges at rows 160 and 184),
  and block 31 repeats rows 0–7 onto rows 0–7.
- **Control EEPROM** U4 AT28C64B: A0–A12 = b3–b15, the bytes of block 0. IO0 is D/CX, IO1 is
  CS̅.
  - Most of block 0 is deselected.
  - SLPOUT comes at byte 7563 (≈ 121 ms after RESET), then CS is HIGH for 5.2 ms.
  - Then COLMOD 55h, MADCTL 60h, INVON, CASET, RASET, DISPON, and RAMWR as block 0's last byte.
  - Outside block 0 (U7 NOR b16–b20, U8 AND), D/CX is 1 (U9 OR) and CS̅ is 0.
- **Registers clocked by CLK** sit between the EEPROMs and the rest: U11 74HC273 for the pixel
  byte, U12 74HC74 for D/CX and CS̅. They read only on clock edges, so never in an EEPROM's `X`
  window after an address change, nor at power-on before the EEPROMs drive (3-state outputs
  start floating, which gave `floating-input` warnings with a 74HC574).
- **Race-free shifting:**
  - The 74HC165 shifts on CLK rising.
  - The module samples on CLKN rising (SCL = CLKN, U6), half a period away.
  - The load window is PL̅ = NAND(BYTE0, CLK) (BYTE0 = NOR b0–b2): LOW in the HIGH half of a
    byte's first period. The window closes on CLK falling, before the counter changes. The
    first design gated with CLKN; its window ended on the counter's own edge, and the simulator
    caught a 10 ns PL̅ glitch (`pulse-width-violation` ×17500), a real race.
- **Timing:** the whole picture after RESET takes 4.1 s of simulated time. Headless under
  vitest it is exact with no diagnostics: 29M events, 28.6 s. The scenario test checks the first
  8 rows (≈ 1.9 s under vitest). At 1 MHz the module reports `wait-violation`.

### ADR-0031: TFT modules

The ADR records:

- the module at command level over SPI;
- the frame memory as the only storage, with the frame computed from it;
- the panel's window as data;
- the `image` primitive and its cache, dropped on restore;
- unknown handling with its caps;
- what is not simulated.

The alternatives considered:

- a part per panel;
- scanning the panel line by line (it would show tearing, but costs a lot and gives little);
- an RGBA buffer kept in the state (it doubles the snapshots);
- drawing pixels as rectangles.

## Tasks

- [x] 1. Data sheets: the module pinout and the BLK circuit; the panel windows (a module data
  sheet per panel; keep only those with a source); the EPF and LUT rules from the rendered
  §8.8 and RAMCTRL pages; each command's defaults and parameter counts into "Data sheet
  numbers" below; ST7789V vs VW differences.
- [x] 2. `library`: the `periph/st7789` skeleton: pins, props, the symbol per panel, the state;
  the serial interface (framing, phase, break and recovery); the command table with
  parameter counts; H/W and S/W reset defaults. Tests: framing, recovery (Figures 20–21),
  defaults.
- [x] 3. `library`: memory writes: CASET/RASET/RAMWR/WRMEMC, MADCTL MX/MY/MV, window wrap,
  out-of-range ignored; COLMOD 12/16/18 with EPF and the RGB bit. Tests: all 8 orientations
  as §8.12 draws them, and each format.
- [x] 4. `library`: the display modes and `st7789Frame` with the panel windows. Tests: on/off,
  sleep, inversion, idle, partial, scroll; a 240 × 240 with MY = 1 shows an unknown band
  without the row offset and a clean picture with it.
- [x] 5. `library`: timing. The Table 6 checks, the reset pulse and its spike rejection, the
  waits as errors with the outcome merged (Q5). Tests: each one just inside (silent) and
  just outside (reported, the touched state unknown); the MSP2008 vendor initialization
  shows its picture under the veil, and a later timely command resolves it.
- [x] 6. `library`: unknowns. `X` bits, merging an uncertain D/CX or command, the caps, a lost
  interface. Tests for each.
- [x] 7. `editor`: the `image` primitive (canvas, recording) and the `tft` drawer with its
  cache, dropped on restore. Symbol-drawing and drawer tests; measure the budget.
- [x] 8. Scenarios: an SPI driver helper (like `lcd-program.ts`), a common initialization
  written from the data sheet, then drawing; the carry-over and rewind properties with the
  TFT; a benchmark of the SPI stream with and without the TFT.
- [x] 9. The TFT Color Bars example (Q3): design the streamer (record it in Design), a
  generator for the circuit and both ROM images (every net checked), a gallery entry, a
  scenario test (the frame equals the expected bars; no diagnostics) and a browser test.
- [x] 10. Docs: components.md (the ST7789 section), editor.md (`tft`, `image`), glossary
  (frame memory, MADCTL, window), ADR-0031, the roadmap section, READMEs, lessons.

## Acceptance criteria

Verified 2026-11-09, before the finish (the finish workflow repeats this after merging `main`).

- [x] `pnpm check` and `pnpm build` are green (3145 unit tests; `pnpm e2e` 92 passed).
- [x] Every simulated command has a function test from the data sheet, and the 8 MADCTL
  orientations write as §8.12 draws them (`st7789.test.ts`, `st7789-controller.test.ts`
  "address mapping", plus the 8 vendor offsets).
- [x] `SWRESET` → `SLPOUT` → `COLMOD 55h` → `MADCTL` → `INVON` → `NORON` → `DISPON` and a fill
  show the expected frame on every panel ("initialized and filled on every panel"). Without
  `INVON`, an IPS panel shows inverted colors. A rotated 240 × 240 needs its row offset
  (`st7789-frame.test.ts`).
- [x] Each SPI write requirement and each wait is silent just inside and reported just outside.
  A command sent too early leaves what it sets uncertain (Q5) (`st7789-timing.test.ts`).
- [x] The frame memory powers on unknown and is drawn as unknown. RESX and `SWRESET` don't
  clear it.
- [x] TFT Color Bars runs headless and in the browser, shows the SMPTE bars and reports no
  diagnostics: the first block in the test, the whole picture once (exact, 0 diagnostics). It
  reports the wait violation when run faster: clocked at 1 MHz, the post-`SLPOUT` gap is
  2.6 ms. That stands in for "the gap shortened", since the gap is a count of bytes.
- [x] The carry-over and rewind properties pass with the TFT. A snapshot of an unchanged TFT
  costs ≤ 4 KiB ("in snapshots").
- [x] The drawer stays within its budget (0.37 ms a changed 240 × 320 frame), and the benchmark
  numbers are recorded here (progress log, task 8).
- [x] Docs, ADR-0031, the roadmap and lessons are updated.

## Open questions

- [x] Q1. Interfaces — _proposed:_ only the 4-line SPI (the breakout modules); 8080 8-bit
  parallel → ideas. — **answer:** only SPI (2026-11-08). 8080 is in the Parts ideas.
- [x] Q2. Reads — _proposed:_ not simulated. A read command (`04h`, `09h`, `0Ah`–`0Fh`,
  `2Eh`, `DAh`–`DCh`…) is reported as a warning ("the module would drive SDA now"),
  because on the bench it would fight the host's SDA. — **answer:** as proposed: a warning
  (`read-not-simulated`); reads are in the ideas.
- [x] Q3. Examples — _proposed:_ **TFT from ROM**: a clock, a 74HC4040, an AT28C256 and a
  74HC165 stream an initialization and a picture into a panel. A 6502 example waits for the
  VIA. — **answer:** TFT from ROM, and the picture is **SMPTE color bars**. See "The
  example" in Design.
- [x] Q5. A command sent during a wait (5 ms after RESX↑, `SWRESET`, `SLPOUT` or `SLPIN`;
  120 ms before `SLPOUT`). The data sheet says "it will be necessary to wait" but not what
  the chip does otherwise, and the MSP1308/MSP2008 vendor code skips both waits and works on
  the bench (task 1). — _proposed:_ an error, and the command's effect is uncertain: the
  registers it sets become unknown (ADR-0014: `X` where outcomes differ), and the glass
  shows the picture under the `X` veil instead of blanking it. _Alternatives:_ an error with
  the command lost (ADR-0022's busy rule; it would blank the vendors' working code), or an
  error with the command applied. — **answer:** as proposed (2026-11-08): an error, both
  outcomes merged, the picture drawn under the `X` veil.
- [x] Q4. Module and panels — _proposed:_ the generic 8-pin header (GND VCC SCL SDA RES DC CS
  BLK); panels 240 × 320 (default), 240 × 240 and 135 × 240, plus any others with a module
  data sheet. — **answer:** as proposed.

## Data sheet numbers

ST7789V V1.3 unless noted. Module documents are at lcdwiki.com/res/<SKU>/ (user manuals, panel
specs, schematics, program packages). The DM-TFT114-397 data sheet is at
displaymodule.com (cdn.shopify.com/s/files/1/0264/7629/files/DM-TFT114-397_Datasheet.pdf).

- Module header (MSP2008 user manual, MSP1141 page, DM-TFT114-397 §3.2): 1 GND, 2 VCC (3.3 V),
  3 SCL, 4 SDA, 5 RES, 6 DC, 7 CS, 8 BLK. MSP1308 (1.3" 240 × 240) has 7 pins and no CS.
- BLK (MSP2008 schematic, DM-TFT114-397 §6): BLK → 1 kΩ → S8050 NPN base, 10 kΩ pull-up to
  VCC, LED cathode through 10 Ω. "The default is floating, and the backlight is turned off at
  low power." So floating or HIGH means lit, and LOW means dark.
- Panels: QDTFT2009 (240 × 320), TFT1301 (240 × 240) and TFT1141 (135 × 240). All are
  "Display Mode: Normally black". Vendor `LCD_direction` offsets (x, y), STM32F103 demos:
  - 135 × 240: MADCTL 00h → (52, 40), 60h (MX MV) → (40, 53), C0h (MY MX) → (53, 40),
    A0h (MY MV) → (40, 52).
  - 240 × 240: 00h → (0, 0), 60h → (0, 0), C0h → (0, 80), A0h → (80, 0).
  - 240 × 320: no offsets.
    These are the orientation tests of task 4.
- Vendor initializations:
  - MSP1141: RES LOW 20 ms, HIGH, 20 ms, then 120 ms, `SLPOUT`, 120 ms, `36h 00`, `3Ah 05`,
    `21h`, then the panel tuning (`B2`, `B7`, `BB`, `C0`, `C2`, `C3`, `C4`, `C6`, `D0`, `D6`,
    `E0`, `E1`) and `29h`.
  - MSP1308 and MSP2008: `36h`, `3Ah 05`, the panel tuning, `21h`, `11h` and then `29h` at
    once ("//Delay (120);" is commented out). This breaks the 5 ms after `SLPOUT` and the
    120 ms from RESX↑ to `SLPOUT`, yet these modules work on the bench. See Q5.
- RAMCTRL p. 259, 65K → frame: EPF 00 → R0 = B0 = 0; 01 → 1; 10 → R0 = R4 (DB15),
  B0 = B4 (DB4); 11 → R0 = B0 = G0 (DB5). No 4K table exists in V1.3 or VW.
- ST7789VW V1.0 vs V1.3: the same command set, plus `POWSAVE` (BCh) and `DLPOFFSAVE` (BDh).

- Table 6 (4-line serial, write): tCSS 15, tCSH 15, tCHW 40, tSCYCW 66, tSHW 15, tSLW 15,
  tDCS 10, tDCH 10, tSDS 10, tSDH 10 ns. Reads: tSCYCR 150, tSHR/tSLR 60, tACC 10–50,
  tOH 15–50 ns.
- Table 9 (reset): tRW ≥ 10 µs. Pulses < 5 µs are rejected, 5–9 µs start a reset, > 9 µs reset.
  tRT is 5 ms (reset in sleep-in) or 120 ms (in sleep-out). Note 7: wait 5 ms after RESX↑
  before commands, 120 ms before `SLPOUT`.
- `SWRESET`: wait 5 ms before a new command; in sleep-in, 120 ms before `SLPOUT`; not during
  the sleep-out sequence. The frame memory is unaffected.
- `SLPIN`/`SLPOUT`: 5 ms before the next command; 120 ms between `SLPOUT` and `SLPIN`.
- Frame memory: 240 × 320 × 18 bits. Power-on: "set randomly"; S/W and H/W reset: "not
  cleared".
- §8.4.2: MSB first. SDA is sampled on SCL↑. D/CX on the 8th SCL↑ (4-line). CS HIGH
  initializes the interface. CS may be grounded permanently (§8.16).
- RAMCTRL (B0h) default 00h/F0h: EPF = 11, ENDIAN = 0. Little endian applies only to the
  8/9-bit parallel buses.
- COLMOD: 03h is 12-bit, 05h 16-bit, 06h 18-bit, 07h 16M truncated. Default 06h (18-bit; RDDCOLMOD 0000 0110).
- VSCRDEF: TFA + VSA + BFA = 320, otherwise undefined.

## Progress log

- 2026-11-08: plan drafted. Data sheets downloaded (ST7789V V1.3, ST7789VW V1.0, QT154H2201).
  LIB-2 added to the Parts track.
- 2026-11-08: Q1–Q4 answered (SPI only; reads warn; TFT Color Bars with SMPTE bars; generic
  8-pin module). Plan approved, branch started.
- 2026-11-08: task 1. Module documents from LCDWiki (MSP2008, MSP1308, MSP1141, with panel
  specs, schematics and vendor programs) and DM-TFT114-397. This confirmed the header, the BLK
  pull-up, three panel windows with offsets for 4 orientations each, normally black glass,
  `INVON` in every init, the EPF rules (p. 259), and the missing 4K LUT. Vendor code for
  MSP2008/MSP1308 skips the `SLPOUT` waits, so Q5 was asked: an uncertain outcome, drawn under
  a veil. Props reduced to `panel`.
- 2026-11-08: task 2. `st7789.ts` (pins, symbol, CS/SCL/RES framing),
  `st7789-controller.ts` (the command table with parameter counts from the data sheet's table
  rows, registers stored per parameter, H/W and S/W defaults: COLMOD/MADCTL "No change" at
  SWRESET, window ends follow MV), `st7789-panels.ts`, a test bench. Warnings: unknown command,
  read not simulated, stray data, partial byte. A basic `tft` drawer keeps the
  symbol-drawing test green, and the image arrives in task 7.
- 2026-11-09: task 3. Memory writes: RAMWR/WRMEMC counters, §8.12 counter table (a window
  starting past its end wraps after every pixel, with a `bad-window` warning), pixels past the
  memory ignored but counted, `gramIndex` (MX/MY mirror the memory's columns/rows whatever MV
  is: the only reading that matches all 8 vendor offsets), 12/16/18-bit and 16M truncated, EPF;
  an undefined COLMOD makes the window unknown (`bad-format`). Note: with EPF 11 (default) pure
  green 07E0h is stored with R0 = B0 = 1.
- 2026-11-09: task 4. `st7789-frame.ts`: pixels as 0xRRGGBB plus `FRAME_UNKNOWN` (memory X)
  and `FRAME_UNCERTAIN` (a shown mode unknown, scroll undefined). `Controller.unknown` with
  `Unknown` bits (filled by tasks 5–6). Decisions: scrolling always maps (the defaults give
  identity; no separate scroll mode, since the data sheet names no exit); the partial
  non-display area is black (PARCTRL's NDL not modeled); the blank page is black; ML = 1
  exchanges the fixed areas.
- 2026-11-09: tasks 5–6 together, since violations feed the unknowns. Table 6 checks (D/CX
  armed on the 8th edge only; a byte completes 10 ns after its 8th edge so hold violations
  reach it; tCSH is reported only, because the byte stands). RESX: < 5 µs gives a
  `reset-rejected` warning, 5–10 µs gives a `pulse-width-violation` and an uncertain reset,
  RES X/Z gives an uncertain reset. Waits per Q5: `wait-violation`, the command runs
  "uncertainly" (registers it sets are unknown where they differ; pixels it writes get
  `PIXEL_UNCERTAIN`). Power-on counts as a reset released at 0, so the 5 ms and 120 ms apply.
  SLPOUT/SLPIN start their waits only when they change the mode. Unknowns follow one model, the
  veil: the likely outcome is shown and marked uncertain. `X` noise is kept for data never
  known (power-on memory, `X` data bits). A command byte with ≤ 3 unknown bits whose
  candidates all lack parameters runs each uncertainly. Anything else, and an unknown D/CX, an
  uncertain SCL/CS or a clock check failure, makes the interface lost: every register unknown,
  the memory veiled, data ignored until the next command (a lost phase recovers at CS↑ or a
  reset). Window and scroll unknown bits are split (COLUMNS/ROWS, SCROLL_AREA/START).
- 2026-11-09: task 7. `RasterImage` + `SymbolGraphics.image` (canvas: an offscreen canvas per
  image object in a WeakMap, nearest-neighbor when magnified; recording: `images`).
  `PartLive.epoch` counts rewinds (`Simulation.#reach`) so caches built from restored state
  don't go stale. The `tft` drawer caches the glass image per controller by (version, epoch,
  panel, X color): unknown memory is noise in the X color, uncertain pixels get a diagonal hatch
  (the veil). A test caught `#ff0000` being parsed as `#ff0`. Budget (vitest, M3 Pro):
  `st7789Frame` 240 × 320 0.32 ms, plus RGBA 0.37 ms, well inside 3 ms; an unchanged glass
  reuses the image. Lesson: imported bindings inside hot loops read through getters under
  vitest (≈ 10× slower), so copy them to locals.
- 2026-11-09: task 8. `tests/scenarios/tft-program.ts`: the TFT Color Bars ROM program (pixel
  AT28C256 + control AT28C64B at 500 kHz; SLPOUT at byte 7563 ≈ 121 ms, the rest 5.2 ms later
  with CS HIGH between, RAMWR as block 0's last byte; block 31 repeats rows 0–7). `tft.test.ts`
  runs it through the controller at the stream's byte times: SMPTE bars exact, no warnings, a
  second pass the same, twice the clock gives `wait-violation`. The part: a CS glitch between
  bytes is harmless (EEPROM output windows at byte boundaries), and lost only if SCL rises
  while CS is unknown or a byte is under way; CS/SCL unknown before they were ever known
  (power-on transient) is silent. Carry-over: random TFT networks (8 seeds) invisible; the
  rewind property already covers every registered part. Bench (`pnpm bench`, M3 Pro): an SPI
  bus from drivers costs 1.41 µs of wall time a byte with no module, 4.62 with one, 13.93 with
  four, so a module adds ≈ 3.1 µs a byte (≈ 0.4 µs a bit).
- 2026-11-09: task 9, circuit and headless tests. The example was generated by a throwaway
  vitest file (copy in the session scratchpad: `gen-tft-example.ts.txt`) with net labels on
  every pin, registered in `example-files.ts`. Two real bugs were found in my own circuit by
  the simulator: the PL̅ race and the power-on floating reads (see "The example"). Tests: EEPROM
  contents equal `tft-program.ts`; after RESET the first block draws exact rows with no
  diagnostics (the full picture was checked once: exact); 1 MHz breaks the waits.
- 2026-11-09: task 9, browser. `tests/e2e/tft.spec.ts`: dark glass before RESET, bars after.
  Looking in the browser (Playwright screenshots, scratchpad `tft-*.png`): the picture is
  upright in landscape and builds top to bottom over the red power-on noise. At 199 % the
  pixels are sharp. Labels point away from the bodies, and the actual speed is ≈ 0.33 s/s, so
  the whole picture takes ≈ 13 s of wall time. That first run also showed red noise before
  RESET: CS was `X` from the counters not yet reset, and the module counted that as lost. Now
  a CS or SCL never yet known is no activity (the project's rule for unknown controls, as for
  E and WE̅).
- 2026-11-09: task 10. Docs: components.md (the ST7789 section), editor.md (`tft`, images,
  `PartLive.epoch`, the example), glossary (frame memory, MADCTL, veil, window), ADR-0031,
  architecture.md, the library and editor READMEs, the LIB-2 section, lessons. While writing
  lessons I found a known pitfall in my code (lessons, R17a): the SCL checks were joined with
  `||`, which hid a cycle violation behind a pulse-width one at the same edge. Fixed, with a
  test of both at once. Full `pnpm e2e`: 92 passed. The Part tab was checked in the browser.
- 2026-11-09: acceptance verified. Two tests were added for criteria not yet backed by one: an
  unchanged TFT's snapshot ≤ 4 KiB (`stateBytes`), and the data sheet init plus a fill on every
  panel. `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- 2026-11-09: finished. `periph/st7789` is the ST7789V module at command level on 4-line SPI:
  three panels with their windows as data, Table 6 and Table 9 checked, the waits as
  `wait-violation` with an uncertain outcome drawn under a veil (Q5), unknowns by the same
  model. The editor got raster images and `PartLive.epoch`. The TFT Color Bars example draws
  SMPTE bars from two EEPROMs. ADR-0031. Merged with `--no-ff`.

## Handoff

- **State:** merged into `main`; nothing pending.
- **Follow-ups** (Parts ideas, "TFT follow-ups (LIB-2)"): the 8080 8-bit parallel interface and
  reads; other TFT controllers (ILI9341, ST7735, GC9A01, ILI9488); the TE output;
  `powerOn: unknown`; a voltage-domain check with level shifters. A 6502 driving the module
  waits for the VIA (R18).
