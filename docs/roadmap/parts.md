# Parts

Track `LIB` of the [roadmap](../roadmap.md).

**Goal:** real chips and IO parts, each following its data sheet — pinout, function table and
timing with the source cited ([components.md](../components.md); recipe:
[add-component.md](../../.ai/workflows/add-component.md)). An item is a family or a group of
chips that designs need.

**Not here:** CPUs and the companion chips of one CPU family (the W65C22 VIA, the 6551 ACIA) —
their architecture's track; analog behavior beyond digital models
([vision](../vision.md#non-goals-for-now)).

## Items

| ID    | Branch                | Title                                      | Needs | Status      |
| ----- | --------------------- | ------------------------------------------ | ----- | ----------- |
| R03   | `feat/io-basic`       | Basic IO parts                             | —     | done        |
| R06   | `feat/74hc-gates`     | 74HC gates & bus buffers                   | —     | done        |
| R08   | `feat/74hc-msi`       | 74HC combinational MSI                     | —     | done        |
| R09a  | `feat/74hc-registers` | 74HC flip-flops, registers + timing checks | —     | done        |
| R09b  | `feat/74hc-counters`  | 74HC counters & shift registers            | —     | done        |
| R12a  | `feat/memory-chips`   | Memory chips                               | —     | done        |
| LIB-1 | `feat/lcd-hd44780`    | Character LCD (HD44780)                    | —     | done        |
| LIB-2 | `feat/lcd-st7789`     | TFT LCD (ST7789)                           | —     | in-progress |

## R03 · Basic IO parts — `feat/io-basic`

Headless behavior + symbol geometry for: VCC/GND rails, toggle switch, push button (momentary),
DIP switch bank, pull-up/pull-down resistor, LED (color prop), LED bar, clock generator
(frequency, duty cycle, manual step), 7-segment display (common anode/cathode), hex display, probe.
Symbols as data (`SymbolDef`); `prim/*` parts got gate-shaped symbols. Real contacts (SPDT /
SPST to a rail) and two-terminal LEDs ([ADR-0007](../adr/0007-io-electrical-model.md)); indicator
on-time accounting for multiplexed displays. Spec: [components.md](../components.md#io-parts-io).
Plan: `.ai/plans/feat-io-basic.md`.

## R06 · 74HC gates & bus buffers — `feat/74hc-gates`

74HC00, 02, 04, 08, 10, 11, 14, 20, 21, 27, 30, 32, 86 (gates), 125, 126, 240, 244 (3-state
buffers) and 245 (bus transceiver) from the Nexperia data sheets: pinouts with pin
descriptions, units, function tables as definition data, timing (`tpd`, `ten`, `tdis`) at
4.5 V / 50 pF citing document, revision and table; function shared per chip number, timing per
logic family. Tests check every function table through physical pin numbers, every delay and
unknown/floating inputs; the carry-over property runs random 74xx networks; a bus scenario shows
contention, the 1 ns fight of a same-instant handover and the 245 both ways. A Part tab in the
bottom dock (drawing, pins with descriptions, function table, datasheet link) follows the part
picked last; Hello, LED runs on a 74HC00. Spec: [components.md](../components.md#74xx-chips-74xx).
Decision: [ADR-0011](../adr/0011-real-chips.md). Plan: `.ai/plans/feat-74hc-gates.md`.

## R08 · 74HC combinational MSI — `feat/74hc-msi`

74HC85, 138, 139, 147, 148, 151, 153, 157, 158, 283 and 4511 from the Nexperia data sheets, and
from TI where Nexperia has none (147, 148, 283; typical delays of the 147 and 283 from the
Philips sheets): one delay per data sheet path (`tpd(An to Yn)`, the longest changed path wins),
4-state results as precise as cheap, the 4511 as the first stateful chip; exhaustive tests for
283, 85 and 4511, cascades (two 85s, two 148s). Behavioral NE555 (`timer/ne555`, TI pinout):
astable, monostable and bistable modes, RA, RB, C as props with SI-prefixed entry, the RC
network's pins drawn but not simulated, `X` until the first trigger or reset. Pin labels (the
151's `Y̅`), changeover switch contacts (`spdt-gnd`), wider DIP bodies for crowded pin names.
Examples: BCD to 7-Segment and Ben Eater's Clock Module. Spec:
[components.md](../components.md#74xx-chips-74xx), [timers](../components.md#timers-timer).
Decision: [ADR-0013](../adr/0013-behavioral-timer.md). Plan: `.ai/plans/feat-74hc-msi.md`.

## R09a · 74HC flip-flops, registers + timing checks — `feat/74hc-registers`

R09 (74HC sequential parts + timing checks) was split at its start into flip-flops and
registers with the timing checks (R09a) and counters and shift registers (R09b).

74HC74, 107, 109, 112 (flip-flops) and 173, 175, 273, 374, 377, 574 (registers) from the
Nexperia data sheets, on two engines (`FlipFlopSpec`, `RegisterSpec`): `X` until reset or
loaded, uncertain clock edges `X` only where they could change a bit, set and reset together as
each data sheet says. Timing checks in core (`TimingChecks`: set-up, hold, pulse width,
recovery) against the guaranteed minima at 25 °C in `timing.min`; a violation is an error in the
Simulation tab and makes the bits the edge may have loaded `X`, armed only while the clock
matters. The 74HC4511 checks its LE. Sequential function tables (`↑`, `h`, `q̅`); the Part tab
shows a chip's delays and minima. Example: Ben Eater's A register (two 173s, two 245s, a bus).
Spec: [components.md](../components.md#edge-triggered-chips),
[simulation.md](../simulation.md#timing-checks). Decision:
[ADR-0014](../adr/0014-timing-checks.md). Plan: `.ai/plans/feat-74hc-registers.md`.

## R09b · 74HC counters & shift registers — `feat/74hc-counters`

74HC161, 163 (synchronous counters), 191, 193 (up/down, asynchronous parallel load), 4040
(12-stage ripple counter: each output one stage delay after the one below, so decoding gates
see the intermediate counts), 164, 165, 595 (shift registers; the 595's storage register one
pulse behind when both clocks are tied, as its data sheet says) from the Nexperia data sheets, on
R09a's timing checks and `X` policy: unknown or late controls merge every mode they allow;
the data sheets' prose usage rules (191 CE̅ and U̅/D, 193's other clock) checked like timing
requirements. `TimingChecks.setupHold` got edge-to-edge and hold-only forms. Pin labels are
overlined as the data sheets draw them — letters, not digits (`1R̅D̅`, `E̅1`), labels can mark
exceptions (`U̅/D`, `Q̅0̅`). Examples: Shift Register LEDs (a self-running Johnson counter) and
Ben Eater's Program Counter. Spec: [components.md](../components.md#counters-and-shift-registers).
Plan: `.ai/plans/feat-74hc-counters.md`.

## R12a · Memory chips — `feat/memory-chips`

R12 (ROM / RAM + memory inspector) was split at its start into the chips with their contents
(R12a) and the inspector with image files (R12b). The 74LS189 went to the backlog with the 74LS
family (TTL inputs, no current data sheet); the SAP-1's RAM is built on a 6116 or 62256.

AT28C16, AT28C64B, AT28C256 (EEPROMs, read as ROMs for now: a write the circuit attempts is
reported) from the Atmel/Microchip data sheets, the 6116 (Renesas, speed grades 15/20/25 ns as a
prop) and the 62256 (Alliance AS6C62256-55) SRAMs: the data sheets' guaranteed limits (no typical
values exist), reads that keep the old data for `tOH`, show `X` until the access time and keep
driving until their release time (a driver turning on sooner fights them), level-sensitive RAM
writes checked against `tAS`, `tAW`, `tWP`, `tCW`, `tDW`, `tDH`, `tWR` (`X` where a violation may
have written). ROM contents in the document (an `image` prop in sparse hex runs), RAM powering on
`X`, zeros or random (seeded by the designator); a memory view (`ComponentDefinition.memory`) and
a debug write (`poke`) for the inspector and test benches; timing as a function of props. The
Part tab shows limits-only timing. Examples: EEPROM 7-Segment Decoder, RAM by Hand. Spec:
[components.md](../components.md#memories-mem). Decision: [ADR-0017](../adr/0017-memories.md). Plan:
`.ai/plans/feat-memory-chips.md`.

## LIB-1 · Character LCD (HD44780) — `feat/lcd-hd44780`

Built between R11b and R15a at the author's request, off the roadmap of the time (it
had no id); numbered LIB-1 when the Parts track was made.

`periph/hd44780`: a character LCD module with the HD44780U controller, 8 × 1 to 40 × 2 (13
sizes), six backlight colors, ROM codes A00 and A02 read off the data sheet's Table 4 by a
script, the oscillator as a prop. The controller at instruction level — 8- and 4-bit transfers
with the nibble phase, busy flag and execution times, `tADD`, reads with their `X` window,
internal pull-ups, the internal reset or (`powerOn: unknown`) an unknown state that only the
data sheet's initialization by instruction resolves — and the 5 V bus timing as timing checks;
writes while busy and before 15 ms are errors (every `*-violation` is, now); uncertain transfers
run every outcome and merge them. Drawn as the module with its glass and dots, backlight on
A/K, contrast on V0, the blink redrawn by a new `animation` hook; the Part tab sets non-`t`
symbols right. Examples: LCD by Hand, LCD Hello, World (74HC4040, AT28C16, 74HC574). Spec:
[components.md](../components.md#hd44780), [editor.md](../editor.md#symbol-drawing). Decision:
[ADR-0022](../adr/0022-character-lcd.md). Plan: `.ai/plans/feat-lcd-hd44780.md`.

## LIB-2 · TFT LCD (ST7789) — `feat/lcd-st7789`

Promoted from an idea at the author's request (2026-11-08). `periph/st7789`: a color TFT module
with the Sitronix ST7789V controller on its 4-line SPI — the 8-pin breakout header (LCDWiki
MSP2008/MSP1141, DM-TFT114-397), one prop `panel` (240 × 320, 240 × 240, 135 × 240) whose window
in the frame memory is data, checked against the vendor offsets in four orientations each. The
controller at command level: every command with its table's parameter count, §8.12's counters
and MADCTL mapping, 12/16/18-bit color with RAMCTRL's EPF, the display modes applied when the
frame is computed (sleep, display, inversion — the normally black IPS panels need `INVON` —
idle, partial, scrolling, RGB swap), the frame memory unknown at power-on; reads and unknown
commands are warnings. Table 6 as timing checks, the reset pulse with spike rejection, the waits
after reset, `SWRESET`, `SLPOUT` and `SLPIN` as `wait-violation` with the command's effect
uncertain — drawn as its likely outcome under a veil, since vendor code that skips them works
(Q5). Drawn as the module with its glass, through a new `SymbolGraphics.image` and a cached
frame (`PartLive.epoch` counts rewinds). Example: TFT Color Bars (SMPTE bars from two EEPROMs,
74HC4040 counters, a 74HC165). Spec: [components.md](../components.md#st7789),
[editor.md](../editor.md#symbol-drawing). Decision: [ADR-0031](../adr/0031-tft-modules.md).
Plan: `.ai/plans/feat-lcd-st7789.md`.

## Ideas

Not scheduled yet; promoting one gives it the next free id and a row in the table.

- More logic families (R06 follow-up): 74HCT and 74AC as timing tables for the existing chip
  specs; 74LS/74F also need TTL inputs (a floating input reads high). The 74LS189 (16 × 4 RAM,
  inverted 3-state outputs; Ben Eater's SAP-1 RAM) comes with them (R12a, Q2); its data sheet
  is the archived Fairchild DM74LS189.
- EEPROM writes from the circuit (R12a follow-up): byte and page writes, the self-timed write
  cycle with DATA polling and toggle bit, the power-on write delay and noise filter, software
  data protection (AT28C64B/256). Until then an EEPROM is a ROM and a write attempt is reported.
- Passive parts (R08 follow-up): resistors, capacitors and potentiometers drawn on the schematic
  but not simulated (BOM, breadboard view), a 555 reading its R and C from them, and turning a
  potentiometer with the Interact tool (Ben's clock speed knob); a read-only hint of a 555's
  resulting frequency in Properties. CMOS 555s (TLC555, ICM7555) and the 556 with the same model.
- Contact bounce for buttons and switches (deterministic pattern), to catch missing debouncing
  before fab (R03 switches change cleanly).
- Bussed resistor network part (SIP-9: 8 pull resistors with a common pin) for DIP switch banks
  and buses.
- LCD follow-ups (LIB-1): 40 × 4 modules (two controllers, `E1`/`E2`); 5 × 10 dot
  glass; compatible controllers and their ROMs (ST7066U, KS0066, Winstar's Cyrillic font), the
  I²C backpack (PCF8574); graphic LCDs (KS0108, ST7920); DDRAM/CGRAM in the Memory tab (a
  `MemoryDef` without address pins, several memories per part); a PWM-dimmed backlight at its
  average brightness; an input-pull-up pin flag, so the design check doesn't say an unconnected
  RS "reads as X" (it reads HIGH — still a mistake for R/W̅).
- TFT follow-ups (LIB-2): the ST7789's 8080 8-bit parallel interface (memory-mapped on a 6502
  bus) and its reads (`RDDID`, `RDDST`, `RAMRD`: SDA turning around); other TFT controllers
  with the same command set (ILI9341, ST7735, GC9A01, ILI9488); the TE output; `powerOn:
  unknown` (RESX not held during power-on); a voltage-domain check for 3.3 V parts on 5 V nets
  with level shifters (74HC4050, 74LVC245).
- Reset supervisor (R17a, Q3): a DS1813-style part holding RESB low for its time after power-on
  and when its pin is pulled low (the W65C02S has no internal reset; until then a button does).
