# Plan: feat/lcd-hd44780

| Field      | Value                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Branch     | `feat/lcd-hd44780`                                                                             |
| Roadmap    | — (off the roadmap; takes the HD44780 LCD out of R18 early) ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                                                    |
| Depends on | R03 (IO parts, lights), R09a (timing checks), R12a (limits-only timing, `X` windows)           |
| Created    | 2026-11-08                                                                                     |

## Goal

A character LCD module with the Hitachi **HD44780U** controller — the `16×2` every hobby
computer prints its first "Hello, world!" on — as a part that behaves like the real module:
the instruction set, 8- and 4-bit bus transfers, the busy flag, execution times, the power-on
reset, and the data sheet's bus timing checked (a write while busy or too short an `E` pulse is
an error, as it is a lost character on the bench). It is drawn on the schematic as the module
— the glass with its 5 × 8 dots lit from the controller's RAM, the pins along the bottom as
Proteus draws its LM016L — in the common sizes (8×1 … 40×2) and backlight colors. A demo
example drives it from real chips. Off the roadmap: it tests what the kernel can do with a
controller that has internal state, timers and a bus, ahead of R18 (VIA, serial) and R20 (the
BE6502 prints on this LCD).

## Scope

**In scope**

- `library`: a new family `periph` with `periph/hd44780` — the module (controller + glass) with
  its 16-pin header; props: size, backlight color, character ROM (A00 Japanese / A02
  European), oscillator frequency, power-on (Q1). The controller at instruction level: DDRAM
  (80 bytes), CGRAM (64 bytes), CGROM (both ROM codes, extracted from the data sheet's
  Table 4), address counter, display shift, cursor/blink, entry mode, function set; reads
  (busy flag and address, data) and writes; 8- and 4-bit interface; internal pull-ups on
  `DB0`–`DB7`, `RS`, `R/W̅`; busy flag with the execution times; `tADD`; the internal reset at
  power-on.
- Bus timing requirements as timing checks (`tcycE`, `PWEH`, `tAS`, `tAH`, `tDSW`, `tH`), reads
  with the `X` window (`tDDR`, `tDHR`), writes while busy, instructions before 15 ms; `X` where
  the outcome is uncertain.
- A pure frame function (what each dot of the glass shows) and a text view of the display, for
  the drawer and for tests.
- `core`: diagnostics of kind `*-violation` are errors (today only the four timing kinds are).
- `editor`: the `lcd` symbol drawer — module, glass, dots, cursor, blink (from simulated time),
  backlight (pins `A`/`K` as an LED), contrast (`V0`); the drawer reads simulated time.
- Examples (Q2), scenario tests (the data sheet's 8- and 4-bit initializations), the
  carry-over and rewind properties with the LCD, browser tests.
- Docs: components.md, editor.md, glossary, ADR-0022, roadmap note, READMEs, lessons.

**Out of scope** (and where it goes instead)

- 40×4 modules (two controllers, `E1`/`E2`) → backlog.
- 5 × 10 dot glass: every module here has 5 × 8 glass; `F = 1` is accepted and shown on it
  (top 8 rows), with a warning → backlog if a 5 × 10 module is ever wanted.
- Analog behavior: contrast voltage levels, the backlight current, power pins (not simulated, as
  for every chip), LCD response time (ghosting) → not planned.
- DDRAM/CGRAM in the Memory tab (Q3) → backlog unless chosen now.
- Other controllers (ST7066U, KS0066, SPLC780 — compatible; Cyrillic ROMs of Winstar modules),
  I²C backpacks (PCF8574), graphic LCDs (KS0108, ST7920) → backlog.
- The VIA, the 6502 driving the LCD → R17, R18, R20.

## Context

Read before starting:

- [docs/components.md](../../docs/components.md) — definition shape, symbols, IO parts (lights,
  LED colors), timing (limits only), timing checks, memories (the `X` window).
- [docs/simulation.md](../../docs/simulation.md) — components at runtime, timers, carry-over,
  snapshots.
- [ADR-0007](../../docs/adr/0007-io-electrical-model.md) (LEDs, sense pins),
  [ADR-0014](../../docs/adr/0014-timing-checks.md) (report, `X` where outcomes differ),
  [ADR-0017](../../docs/adr/0017-memories.md) (limits only, read windows).
- `src/library/mem/memory.ts` (read path), `src/core/timing-checks.ts`,
  `src/library/io/seven-segment.ts`, `src/editor/symbols/io.ts`, `src/editor/simulation.ts`
  (`LivePart`), `tests/scenarios/carry-over.test.ts`, `tests/scenarios/rewind.test.ts`.
- Data sheet: Hitachi HD44780U (LCD-II), ADE-207-272(Z), '99.9 Rev. 0.0 — copy in the
  scratchpad (`ds-hd44780/hd44780u.pdf`, from sparkfun.com/datasheets/LCD/HD44780.pdf).

## Design

### The part

`periph/hd44780`, name `HD44780`, title "Character LCD module (HD44780)", designator `DS`,
keywords `lcd`, `hd44780`, `character display`, `1602`, `2004`. One part for every size: the
controller is the same, only the glass and its wiring to DDRAM differ.

Pins — the module's 16-pin header (pinout from a module data sheet, task 1):

| No.  | Name   | Drawn | Dir       | What                                                       |
| ---- | ------ | ----- | --------- | ---------------------------------------------------------- |
| 1    | `VSS`  | VSS   | power     | ground                                                     |
| 2    | `VDD`  | VDD   | power     | +5 V                                                       |
| 3    | `V0`   | V0    | in, sense | contrast: LOW → characters visible; floating or HIGH → not |
| 4    | `RS`   | RS    | in        | register select (0 instruction, 1 data); pulled up inside  |
| 5    | `RW`   | R/W̅   | in        | read / write; pulled up inside                             |
| 6    | `E`    | E     | in        | enable: reads while HIGH, writes on the falling edge       |
| 7–14 | `DB0`… | DB0…  | bidir     | data bus; pulled up inside (weak 1 while not driving)      |
| 15   | `A`    | A     | in, sense | backlight LED anode                                        |
| 16   | `K`    | K     | in, sense | backlight LED cathode                                      |

- **Pull-ups** (data sheet: "Pull-up MOS current −Ip 50/125/250 µA, DB0–DB7, RS, R/W"): the
  `DB` pins drive weak 1 whenever they don't output, so `DB0`–`DB3` left open in 4-bit mode
  read HIGH, as on the bench. `RS` and `R/W̅` are `in` pins (an input can't drive): a floating
  one is reported like any floating input and read as HIGH (`R/W̅` open = read mode, the chip
  then drives the bus). `E` has no pull-up.
- **Backlight**: `A`/`K` as an LED (lit while A = 1 and K = 0; `ledLight`), drawn as the glass
  lit or dark. **Contrast**: `V0` read by the drawer only (sense): 0 → normal; `Z`/1 → no
  characters (the classic "it works but shows nothing" of an open contrast pin).

Props:

| Key          | Type | Default        | Values                                                                                                                                                                                |
| ------------ | ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `size`       | enum | `16x2`         | `8x1`, `8x2`, `16x1`, `16x1-8x2` (addressed as 8×2), `16x2`, `16x4`, `20x1`, `20x2`, `20x4`, `24x1`, `24x2`, `40x1`, `40x2` (columns × lines, as the industry names them: 1602, 2004) |
| `backlight`  | enum | `yellow-green` | `yellow-green` (dark dots), `blue` (white dots), `white` (black dots), `black` (white dots), `amber`, `red`                                                                           |
| `rom`        | enum | `A00`          | `A00` (Japanese standard: ASCII + katakana), `A02` (European standard: Latin-1, Greek, Cyrillic)                                                                                      |
| `oscillator` | int  | 270 kHz        | 190–350 kHz (data sheet's Rf oscillation min/typ/max): execution times scale by 270 / f                                                                                               |
| `powerOn`    | enum | `reset`        | Q1: `reset` (internal reset worked), `unknown` (it didn't: initialize by instruction)                                                                                                 |

### Display mapping (DDRAM → glass)

Each glass position is wired to a common group (line 1 or line 2 of the controller) and a
segment column: `16×2` = line 1 columns 0–15 / line 2 columns 0–15; `20×4` = line 1 0–19,
line 2 0–19, line 1 20–39, line 2 20–39 (the controller is two lines of 40; DDRAM rows
`0x00`, `0x40`, `0x14`, `0x54`); `16×4` rows at `0x00`, `0x40`, `0x10`, `0x50`; `16x1-8x2`
columns 0–7 on line 1, 8–15 on line 2 (needs `N = 1`); 1-line sizes use line 1 only. A position
shows DDRAM `(shift + column) mod L` of its line: `N = 1` → lines at `0x00`/`0x40`, `L = 40`;
`N = 0` → one line of 80 at `0x00`, `L = 80`, and positions on line 2 stay blank (a 16×2
left in the power-on 1-line mode shows only its top line — a classic mistake, reproduced
without special code). One table per size, data in the library.

### The controller

State (plain data, typed arrays): `ddram[80]`, `cgram[64]` and their unknown-bit masks; the
registers (`AC` and whether it points into DDRAM or CGRAM, display shift, `DL N F D C B I/D S`),
a mask of unknown registers, the 4-bit interface's nibble phase and pending nibble, the busy
deadline, the address the busy-flag read shows (`AC` before `tADD`), the "first read invalid"
flag, the read path's times, the timing checks' pin times.

- **Instructions** (Table 6) take effect at `E` falling (what the glass shows changes at once);
  the busy flag stays 1 for the execution time: 37 µs, Return home 1.52 ms, Clear display 1.52 ms
  (the data sheet leaves it blank; the same as Return home, as module data sheets give),
  scaled by 270 kHz / `oscillator`. Data write/read: `AC` moves at the end of the busy period +
  `tADD` (Figure 10's 1.5 / f = 5.6 µs; Table 6 says 4 µs — the longer is used, noted).
- **Busy flag/address read** (RS = 0, R/W̅ = 1): `DB7` = BF, `DB6`–`DB0` = AC; allowed while busy.
- **Data read** (RS = 1, R/W̅ = 1): the data register, then `AC` moves. The first read after a
  write without an address set or cursor shift returns invalid data (data sheet) → `X` + warning.
- **4-bit** (`DL = 0`): two transfers on `DB7`–`DB4`, high nibble first, for writes and reads;
  `DB0`–`DB3` are not driven. The nibble phase is state: a CPU reset in the middle of a byte
  leaves the module out of step, exactly as on the bench, until the program resynchronizes.
- **Power-on** (`reset`): the data sheet's internal reset — display clear, 8-bit, 1 line, 5 × 8,
  display off, increment, no shift — busy for 10 ms from t = 0.
- **Addresses**: 2-line `AC` wraps `0x27 → 0x40`, `0x67 → 0x00`; 1-line `0x4F → 0x00`; CGRAM 6
  bits. An address the data sheet doesn't allow (`0x28`–`0x3F` in 2-line mode) is reported
  (warning) and writes there change nothing visible.
- **Blink** (409.6 ms at 250 kHz → ×250/f): drawn from simulated time, no kernel events (a timer
  every 200 ms would show up in steps, the debugger's "next event" and the event count).
- Cursor and blink at a CGRAM `AC` are "meaningless" (data sheet): not drawn.

### Bus timing (5 V table: VCC = 4.5–5.5 V, Ta = −30…+75 °C)

| Key      | Value      | Kind        | Checked as                                                                       | On violation                                                             |
| -------- | ---------- | ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `tcycE`  | 500 ns min | requirement | `E` rise to rise                                                                 | `cycle-violation`; the transfer's byte unknown                           |
| `PWEH`   | 230 ns min | requirement | `E` HIGH                                                                         | `pulse-width-violation`; the byte unknown                                |
| `tAS`    | 40 ns min  | requirement | `RS`, `R/W̅` to `E` rise                                                          | `setup-violation`; the transfer's kind uncertain (below)                 |
| `tAH`    | 10 ns min  | requirement | `E` fall to `RS`, `R/W̅`; also any change while `E` is HIGH                       | `hold-violation`; kind uncertain                                         |
| `tDSW`   | 80 ns min  | requirement | `DB` to `E` fall (writes)                                                        | `setup-violation`; those bits unknown                                    |
| `tH`     | 10 ns min  | requirement | `E` fall to `DB` (writes)                                                        | `hold-violation`; those bits unknown                                     |
| `tDDR`   | 160 ns max | output      | `E` rise to data valid (reads): `X` from the rise, data after `tDDR`             | —                                                                        |
| `tDHR`   | 5 ns min   | output      | data held after `E` falls, then released (weak 1)                                | —                                                                        |
| busy     | Table 6    | requirement | a write or data read while BF = 1                                                | `busy-violation`; a write is ignored ("not accepted"), a read drives `X` |
| power-on | 15 ms min  | requirement | a write before 15 ms (Figures 23/24: "wait for more than 15 ms after VCC rises") | `power-on-violation`; ignored while still busy (10 ms)                   |

`Er`/`Ef` (rise/fall ≤ 20 ns) need no check: edges are instant. `TimingDef` keeps `typical`
empty (limits only, as memories), the requirements in `min`, `tDDR` and the execution times in
`max`, as a function of props (the oscillator). New kinds end in `-violation`, which `core`
makes errors (Q: none; a one-line rule in `diagnosticSeverity`, documented).

### Unknowns (`X`), as ADR-0014 asks: report, `X` where the outcome differs

- Unknown data bits (an `X` bus, a `tDSW`/`tH` violation, a short `E` pulse) → a data write
  stores unknown bits (the character draws as unknown); an instruction whose code bits are
  unknown makes unknown what it could change: a known class with unknown operands (Set DDRAM
  address with an `X` bit) → those registers; an unknown class → every register, and the
  DDRAM cells where a Clear display could have changed them.
- Kind uncertain (`tAS`/`tAH`): instruction or data, read or write — every register and the
  cell at `AC` unknown; a possible read drives `X` while `E` is HIGH.
- `AC` unknown → a data write merges into every cell (unknown where they differ), a read is `X`.
- `E` uncertain (from/to `X`/`Z`, after it was known once — gate outputs start `X`): reported
  (`uncertain-enable`, warning), treated as a possible transfer of unknown kind.
- Drawing: a character with unknown bits → an unknown cell (the `X` color, hatched); an unknown
  `D`, `N`, `F` or shift → the whole glass unknown; unknown `C`/`B`/`AC` → no cursor.

### Power-on `unknown` (Q1)

The internal reset needs the supply to rise in 0.1–10 ms and stay off ≥ 1 ms before (Figure 28);
otherwise "initialization must be performed by the MPU". With `powerOn: unknown` every register
and cell starts unknown, and the interface is one of 8-bit, 4-bit awaiting the high nibble, or
4-bit awaiting the low one (a small set of hypotheses, each with its pending nibble). Every
transfer advances each hypothesis; the data sheet's sequence — `0x3` three times, then (4-bit)
`0x2` — collapses them to one known interface, and the instructions after it make the
registers known one by one. The waits between the three function sets (> 4.1 ms, > 100 µs) are
checked while the interface is unknown (`init-violation`): an unknown instruction may be a
Clear display still running. A program without the sequence keeps an unknown display.

### The frame (library) and the drawer (editor)

- `hd44780Frame(state, props, blinkOn)` → per glass position the 8 dot rows (5 bits each) and
  whether it is unknown; codes `0x00`–`0x0F` from CGRAM (`0x08`–`0x0F` mirror `0x00`–`0x07`),
  the rest from the CGROM; cursor (row 8 all on) and blink (the cell all on in the blink's on
  phase). `hd44780Text(state, props)` → the lines as text (ASCII, ¥, →, ←, katakana as
  half-width Unicode, `·` for CGRAM codes, `?` unknown) for tests and the Part tab (if cheap).
- Drawer `lcd`: a module board (PCB green), the bezel and glass in the backlight's colors (on:
  lit; off: the dim reflective look; negative types nearly unreadable without backlight), the
  dots (lit / unlit faintly visible), the pins' names along the bottom inside the board, pins
  out of the bottom edge at fixed offsets 1–16 from the left — so changing `size` never moves
  a wire. Body width = max(18, glass width + margins), height from the line count. At low zoom
  a character draws as one block. `PartLive` gains `time` (simulated now) for the blink.
- Idle (not simulating): the glass unlit, no characters (a module before power-on).

### Character ROM from the data sheet

Table 4 (A00, page 17; A02, page 18) is vector art: render it with `pdftoppm -gray` at high
resolution and read the dot grid — `scripts/extract-hd44780-font.ts` (Node, no packages: a PGM
reader, the grid's cell positions found from the table's lines) writes
`src/library/periph/hd44780-font.ts` (per code 8 rows of 5 bits; the 32 5 × 10 codes 11 rows).
Kept in the repo, so the font can be regenerated and checked; spot-checked glyphs in tests
(`A`, `g`, `¥`, `→`, ｱ, `0xFF` all on, A02's `Ж`).

### ADR-0022: Character LCD modules

One part for every size (the controller is the same; size and wiring are data); the controller
modeled at instruction level, not COM/SEG drive; bus requirements as violations and busy as a
requirement, `*-violation` = error; `X` where outcomes differ; power-on by the internal reset
with an `unknown` alternative; the font extracted from the data sheet; the glass drawn from a
pure frame function, the blink from simulated time.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. Data sheets: a module data sheet for the header pinout and backlight (16×2, e.g.
  Hitachi LM016L / a current maker); record the numbers below. `scripts/extract-hd44780-font.ts`
  and the generated `hd44780-font.ts` (A00, A02); font tests.
- [x] 2. `core`: `*-violation` kinds are errors; test. `library`: `periph` family,
  `periph/hd44780` — pins, props, symbol geometry, timing (function of props), the display
  mapping per size, state, the instruction set, 8/4-bit writes and reads, pull-ups, busy and
  `tADD`, power-on reset, `hd44780Frame`, `hd44780Text`; tests: every instruction (Table 6),
  every size's mapping with shifts, 4-bit transfers and the nibble phase, BF/AC and data reads
  (`tDDR`, `tDHR` measured), first-read-invalid, CGRAM characters, execution times and the
  oscillator.
- [x] 3. `library`: bus timing checks and unknowns — each requirement just inside (silent) and
  just outside (the diagnostic and its `X`), busy, power-on 15 ms, uncertain `E`, unknown bits
  in data and instructions, unknown `AC`; mutation-checked.
- [x] 4. (Q1) `powerOn: unknown` — interface hypotheses, the init waits; tests: Figures 23 and 24
  bring every hypothesis to the known state; short waits and missing steps stay unknown.
- [x] 5. `editor`: the `lcd` drawer, `PartLive.time`; symbol-drawing test, drawer tests
  (recording graphics); looked at in the browser — every size, backlight, both themes, zoom.
- [ ] 6. Scenarios: the data sheet's 8-bit (Figure 23) and 4-bit (Figure 24) initializations
  and "Hello, world!" from a test driver; a 74HC574 driving the bus too early (`tDSW`); a read
  with a driver still on the bus (contention); the carry-over and rewind properties with the
  LCD.
- [ ] 7. Examples (Q2) with generators (every net checked), gallery entries; scenario: each
  example runs headless and shows its text with no diagnostics; browser test: open, run, see
  the module; place one, change `size` and `backlight` in Properties.
- [ ] 8. Docs: components.md (`periph` family, the HD44780 section), editor.md (drawing),
  simulation.md (severity rule), glossary (DDRAM, CGRAM, CGROM, BF, AC), READMEs, ADR-0022;
  roadmap (R18 says the LCD came early here; backlog: 40×4, 5 × 10 glass, compatible
  controllers, I²C backpack, graphic LCDs, LCD RAM in the Memory tab if not done); lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check` and `pnpm build` are green.
- [ ] The data sheet's 8-bit and 4-bit initializations (Figures 23, 24) followed by text show
  the text on a 16×2 headless (`hd44780Text`), with no diagnostics.
- [ ] Every bus requirement just inside its limit is silent and just outside is reported as an
  error, with the `X` effects of the design; a write while busy is reported and ignored; a
  write before 15 ms is reported.
- [ ] Reads: BF/AC and data in 8- and 4-bit mode, `X` until `tDDR`, held `tDHR`, released to
  the pull-ups; a driver left on the bus during a read is a contention.
- [ ] Every size shows the right DDRAM addresses, with display shift; a 2-line module in 1-line
  mode shows only its top line.
- [ ] A00 and A02 come from the data sheet's Table 4 by the script; spot checks pass.
- [ ] The examples run headless and in the browser and show their text; changing `size` and
  `backlight` redraws the module without moving its pins.
- [ ] The carry-over and rewind properties pass with the LCD in their circuits.
- [ ] Docs, ADR-0022, roadmap note, lessons updated.

## Open questions

- [x] Q1. Power-on: only the internal reset, or also `powerOn: unknown` (initialization by
  instruction checked)? — _proposed:_ both, `reset` by default (Ben Eater's code relies on the
  internal reset and works on the bench; `unknown` tests that an init routine also survives a
  bad supply). — **answer:** both, `reset` by default (2026-11-08).
- [x] Q2. Examples — _proposed:_ two. **LCD Hello, World**: a 10 kHz clock steps a 74HC4040
  through an AT28C16 whose bytes are latched by a 74HC574 into the LCD's 4-bit bus (`DB7`–`DB4`,
  `RS`, `E`: three steps per nibble, so data never changes with `E`), running the data sheet's
  4-bit initialization with its waits and printing "Hello, world!"; a RESET button clears the
  counter (it powers on unknown), and the counter's `Q11` stops the clock at the end. **LCD by
  Hand**: 8-bit, DIP switches on `DB0`–`DB7`, switches on `RS` and `R/W̅`, a button on `E` (Ben
  Eater's first LCD video). — **answer:** both (2026-11-08).
- [x] Q3. DDRAM/CGRAM in the Memory tab — _proposed:_ backlog (the `MemoryDef` needs address
  pins and one memory per part; a core and inspector change of its own). — **answer:** backlog
  (2026-11-08).
- [x] Q4. Type id and family — _proposed:_ `periph/hd44780` (docs/components.md already lists it
  for R18; one part with a `size` prop). — **answer:** `periph/hd44780` (2026-11-08).

## Data sheet numbers

HD44780U, ADE-207-272(Z) Rev. 0.0 (1999-09):

- Bus timing, 5 V (page 52): write — `tcycE` 500, `PWEH` 230, `tEr/tEf` ≤ 20, `tAS` 40, `tAH`
  10, `tDSW` 80, `tH` 10 ns; read — `tcycE` 500, `PWEH` 230, `tAS` 40, `tAH` 10, `tDDR` ≤ 160,
  `tDHR` ≥ 5 ns. (3 V table: 1000, 450, 60, 20, 195, 10; `tDDR` 360 — not used.)
- Execution times at 270 kHz (Table 6, max): Clear display — (blank), Return home 1.52 ms,
  others 37 µs, BF read 0; `tADD` 4 µs (Table 6) vs 1.5 / f (Figure 10). Oscillator (Rf =
  91 kΩ, 5 V): 190 / 270 / 350 kHz. Blink 409.6 ms at 250 kHz.
- Internal reset: busy 10 ms after VCC reaches 4.5 V; supply rise 0.1–10 ms, off ≥ 1 ms
  (page 53, Figure 28). Init by instruction (Figures 23, 24): > 15 ms, `0x3`, > 4.1 ms, `0x3`,
  > 100 µs, `0x3`, (`0x2`), function set, display off, clear, entry mode.
- Pull-up MOS current (5 V): 50 / 125 / 250 µA on DB0–DB7, RS, R/W (page 51).
- Table 4 (pages 17–18) is vector art; rendered at 400 dpi (`pdftoppm -r 400 -gray`) a dot
  pitch is 17 px. A00's columns A and B sit a third of a pitch right of the others (each
  column gets its own lattice origin); A00's 5 × 8 glyphs use rows 0–6 (row 7 is the cursor
  row), A02's use rows 0–7 (accents in row 0, capitals from row 1); A00 0xE0–0xFF are 5 × 10
  (rows 0–9; in 5 × 8 mode rows 0–7 show, descenders cut). Checked by eye against the
  rendered cells: `0`, `A`, `¥`, `→`, `ｱ`, `°`, A02 `Б`, `Л` (tests).

Module: Newhaven NHD-0216K1Z-FL-YBW product specification, rev. 13 (2022-11-09), driver
ST7066U (HD44780-compatible): pins 1 `VSS`, 2 `VDD`, 3 `V0` (contrast, ≈ 1.3 V), 4 `RS`,
5 `R/W`, 6 `E` ("falling edge triggered"), 7–14 `DB0`–`DB7` (`DB0`–`DB3` unused in 4-bit
mode), 15 `LED+` (anode, +5 V via an on-board resistor), 16 `LED−` (cathode); Clear display
1.52 ms at 270 kHz (Table of Commands). From newhavendisplay.com/content/specs/.

## Progress log

- 2026-11-08 — plan drafted; Q1–Q4 answered as proposed; started.
- 2026-11-08 — task 1: module data sheet (Newhaven NHD-0216K1Z, pinout, Clear display time);
  `scripts/extract-hd44780-font.ts` reads A00 and A02 off Table 4 (per-column lattice origin:
  A00's columns A/B are shifted; a 6 px margin had clipped the edge rows), `hd44780-font.ts`,
  `hd44780-rom.ts` with spot-check tests.
- 2026-11-08 — task 2: `core` — `*-violation` kinds are errors, `TimingChecks.cycle` (kind
  `cycle-violation`, for `tcycE` and later the CPUs' `tCYC`); `PartLive.time`. `library` —
  `periph/hd44780` split in four: `hd44780-modules.ts` (sizes, glass wiring, `shownCell`),
  `hd44780-controller.ts` (pure: registers, RAMs, interface modes, busy; uncertainty = run every
  outcome exactly and merge), `hd44780-frame.ts` (frame, text, blink), `hd44780.ts` (pins,
  props, timing, the bus glue with its checks: a transfer completes `tAH` = `tH` = 10 ns after
  `E` falls, so hold-window changes still make it uncertain). A basic `lcd` drawer came along
  (the symbol test needs one for every shipped kind); polished in task 5. 51 tests,
  mutation-checked (18 mutations, all killed). Design changes on the way: no `init-violation`
  kind — while the controller may be busy (an unknown outcome), a write is a `busy-violation`
  ("may be busy") and is merged as maybe-accepted; the waits that follow from it are the
  execution times at the oscillator (the data sheet's 4.1 ms / 100 µs cover slower clocks).
  DDRAM cells: 1-line address `a` is cell `a`, 2-line `0x40 + k` is cell `40 + k` (so 1-line
  0x28–0x4F is 2-line 0x40–0x67). RS/R/W̅ changing while `E` is HIGH: `hold-violation`.
  Blink: 409.6 ms is one phase (a period of 819.2 ms at 250 kHz).
- 2026-11-08 — task 3: `hd44780-timing.test.ts` — tAS, tAH (and RS changing while E is HIGH),
  tDSW, tH, PWEH, tcycE each at the limit and 1 ns past it; busy (write ignored, data read X),
  power-on 15 ms (ignored before 10 ms), CGRAM unknown at power-on, unknown data and address
  bits, uncertain E (reported only once E was known), uncertain R/W̅ on a read. The merge is
  as precise as hoped: a late RS on a data write leaves AC known (Set CGRAM 0x01 and "write
  at 0, move to 1" agree) and only CGRAM-or-DDRAM unknown. 20 more mutations: two survived
  (DB0–3 changing late in 4-bit mode, "the transfer may not have happened") until the tests
  checked exactly that.
- 2026-11-08 — task 4: `hd44780-power-on.test.ts` — Figures 23 and 24 from every interface mode
  to a fully known controller (the mode resolves after the third 0x3, as the data sheet says),
  a 1 ms first wait leaves it unknown (a Return home may still run: busy-violation "may be"),
  Ben Eater's 8-bit code without the three 0x3 stays unknown (works with the reset). Bug found
  by tracing Figure 24 first: merging outcomes mixed the pending nibble of outcomes not
  awaiting a low nibble — now merged only across LOW outcomes. One equivalent mutation
  (maybeBusyUntil ≥ busyUntil always) simplified away.
- 2026-11-08 — task 5: looked at in the browser (Playwright from the scratchpad, Vite on 5210):
  four sizes and colors, both themes, zoom, idle, Properties, Part tab. Fixes: the glass was
  small on its board — dot pitch 0.15 cells (16 × 2 body 18 × 6, glass ≈ 80 % of the width
  like a real 1602); pin names 0.42 cells (hidden below `minPx` at 92 %). Found: the canvas
  redraws only on events or light changes, so a blinking cursor in an idle circuit froze —
  `ComponentDefinition.animation(state, props)` (core) gives the length of one look, the host
  redraws when the phase changes (test + mutation). The Part tab took every timing key as `t`
  - subscript (`Clear display` → "tlear display", `PWEH` → "tWEH"): `symbolParts` sets `t…` and
    `PW…` with subscripts, descriptive keys as they are. Drawer tests: backlight by A/K, V0
    contrast, unknown cells, idle look, pin names.

## Handoff

- **State:** tasks 1–5 done: the part, both power-on modes, the drawer (looked at in the
  browser), the blink redraw, the Part tab's symbols.
- **Next step:** task 6 — scenarios: the data sheet's initializations driven by real chips
  (a 74HC574 on the bus), a too-early latch (tDSW), a read contention; the carry-over and
  rewind properties with the LCD in their circuits.
- **Watch out:** the data sheet copy is in the session scratchpad only; download it again if
  the scratchpad is gone.
- **Verify with:** `pnpm check`.
