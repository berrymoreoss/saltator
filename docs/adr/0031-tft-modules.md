# 0031. TFT modules: the ST7789 at command level, the frame memory as the only picture, the veil for uncertain effects

- **Status:** accepted
- **Date:** 2026-11-09
- **Roadmap item:** LIB-2 (feat/lcd-st7789)

## Context

Small color TFT modules with the Sitronix ST7789V are what hobby builds put next to the
character LCD (LIB-1, ADR-0022). They come as 240 × 320, 240 × 240 and 135 × 240 IPS panels on an
8-pin SPI breakout. Forces:

- **Test before fab**: the bugs are on the glass — colors inverted without `INVON`, the picture
  shifted with garbage in a band on a rotated 240 × 240 that needs a row offset, R and B swapped,
  the waits after reset and `SLPOUT` skipped.
- The frame memory is 240 × 320 × 18 bits, 76 800 pixels. It is part of the simulator state, so
  snapshots copy it (ADR-0021). The schematic has to show it at interactive frame rates, but the
  drawing interface (`SymbolGraphics`) had only vector paths and text.
- The data sheet doesn't say what a command sent within a wait does. Vendor code that skips the
  `SLPOUT` waits works on the bench (LCDWiki's MSP2008 and MSP1308 programs), which rules out
  ADR-0022's "reported and not accepted": that would blank code known to work.
- Modules differ in their panel's place in the memory (offsets) and in their header. The
  sources for each panel are module documents and vendor programs, not the controller's data
  sheet.
- The kernel is 4-state. An `X` bit on SDA, an uncertain D/CX or a clock glitch must not throw
  the whole picture away, and must not hide a real problem either.

## Decision

- **One part, `periph/st7789`**, the module with the common 8-pin header (GND, VCC, SCL, SDA,
  RES, DC, CS, BLK; MSP2008, MSP1141, DM-TFT114-397). One prop, `panel`, whose glass and window
  in the frame memory are data (240 × 320; 240 × 240 on rows 0–239; 135 × 240 on columns 52–186,
  rows 40–279), checked against the vendor offsets in four orientations each. All three panels
  are normally black IPS. The pins sit along the bottom at fixed offsets, so a panel change
  keeps the wires. BLK is a sense pin (lit while HIGH or open).
- **The controller at command level, 4-line SPI only** (Q1):
  - every command with its table's parameter count, parameters stored as they arrive;
  - §8.12's counters with MADCTL's mapping;
  - 12/16/18-bit formats with RAMCTRL's EPF;
  - the display modes applied when the frame is computed, never to the memory.
  - Reads and unknown command codes are warnings, and their bytes are ignored (Q2).
- **Table 6 as timing checks** (D/CX checked on the 8th edge only) and the reset pulse with its
  spike rejection. **The waits** after RESX↑, `SWRESET`, `SLPOUT` and `SLPIN` are
  `wait-violation` errors, and **the command's effect is uncertain** (Q5).
- **The veil**: an uncertain effect is shown as its likely outcome and marked uncertain. That
  covers a wait broken, a command byte that may be one of a few, and a reset that may or may
  not have happened. Registers it sets become unknown where the outcomes differ, pixels it
  writes are `PIXEL_UNCERTAIN`, and the glass draws them under a hatch of the `X` color. A
  later command sent in time makes them known again. `X` noise is kept for data never known:
  the memory at power-on ("set randomly") and pixels written with unknown bits. A lost
  interface leaves every register unknown and veils the memory until the next command, which
  D/CX = 0 always marks. A lost interface means an unknown D/CX, an edge while CS is unknown,
  a clock check failing or RESX unknown. A control never known yet is no activity, and a CS
  glitch between bytes is harmless.
- **The frame memory is the only picture.** `st7789Frame(controller, panel)` (pure) computes
  the glass's pixels from it. `SymbolGraphics.image` draws a `RasterImage` through an offscreen
  canvas kept per image object. The `tft` drawer caches the image per controller by its version
  and `PartLive.epoch`, which counts rewinds, because a restored version counter may repeat
  with other pixels.

## Consequences

- A TFT program is checked against the data sheet, and the classic module mistakes show on the
  glass. The waits are reported without blanking code that works on real modules.
- The example (TFT Color Bars) caught two real races in its own design while it was built: a
  10 ns load pulse on the 74HC165 where the load window ended on the counter's edge, and gates
  reading EEPROM outputs before they drove at power-on. Registers clocked by CLK fixed both.
- A changed 240 × 320 frame costs ≈ 0.4 ms to compute and convert; an unchanged one is a
  `drawImage`. The frame memory is 300 KiB of state, but snapshots share unchanged 4 KiB pages,
  and a module adds ≈ 3 µs of wall time per SPI byte.
- `SymbolGraphics.image` and `PartLive.epoch` are general: graphic LCDs (KS0108, ST7920) and
  other TFT controllers (ILI9341, ST7735) can reuse them.
- Not modeled: reads, the 8080, 3-line and RGB interfaces, TE, CABC and brightness, gamma, NVM,
  the refresh scan (tearing), PARCTRL's non-display level (black), voltages (the part is 3.3 V
  and its inputs aren't 5 V tolerant: only the Part tab says so). The 4K look-up table isn't in
  the data sheet; 4-bit channels repeat their MSBs into the low bits. These are in the Parts
  ideas.

## Alternatives considered

- **A part per panel** (`periph/st7789-240x240`…) — more type ids for one controller; the window
  is data, as LIB-1's glass wiring is.
- **The 8080 parallel interface too** — it maps onto a 6502 bus, but the breakouts don't bring
  it out; it is in the ideas (Q1).
- **Commands within a wait lost** (ADR-0022's busy rule) — it blanks vendor code that works on
  the bench. **Applied silently with an error** — it hides that the data sheet doesn't promise
  it. The veil shows the likely picture and says it isn't guaranteed (Q5).
- **Strict `X` for every uncertain effect** (noise) — honest by ADR-0014, but a skipped wait
  would erase a picture that a real module shows, and the user would see noise, not their bug.
  `X` stays for data nobody ever knew.
- **An RGBA buffer kept in the state** — it doubles the snapshots and must be restored with
  them; the frame is cheap enough to compute when the version changes.
- **Drawing pixels as rectangles** — 76 800 rectangles a frame is far too slow.
- **Simulating the panel's line scan** (tearing, partial refresh) — costs an event per line and
  shows little a schematic designer needs.
