# 0013. Behavioral timer: the 555's RC network as props, its pins not simulated

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R08 (`feat/74hc-msi`)

## Context

Ben Eater's clock module, the first module of milestone M2, is three NE555 timers (astable
clock, monostable step button, bistable auto/manual switch) and three gate chips. A 555's timing
comes from analog parts: resistors and a capacitor whose voltage the chip compares with ⅓ and
⅔ VCC. The simulator is digital and has no resistors or capacitors. Its pull resistor is a
logic part.

The data sheet's function table (TI NE555, table 6-1) is digital once voltages are read as
levels: RESET low resets; TRIG below ⅓ VCC sets; THRES above ⅔ VCC resets; otherwise the output
holds. The time between those events in astable and monostable mode is given by equations of R
and C.

## Decision

- `timer/ne555` is a DIP-8 part with the TI pinout and a `mode` prop: `astable` (default),
  `monostable`, `bistable`.
- The external timing network is props: `ra`, `rb` (astable only), `c`, entered with SI
  prefixes (`4.7k`, `100n`; `PropDef.si`). The behavior turns them into times with the data
  sheet's equations: tH = 0.693 (RA + RB) C, tL = 0.693 RB C, tw = 1.1 RA C. The first astable
  high time is 1.1 (RA + RB) C, because the capacitor charges from 0 V.
- Pins wired to the RC network in a mode are drawn and connectable but not simulated (`nc` in
  that mode, described as such): astable TRIG, THRES, DISCH; monostable THRES, DISCH. CONT is
  never simulated. The pin list is a function of the mode; pin numbers never change.
- Bistable mode is the function table on TRIG, THRES and RESET, with DISCH an open-collector
  output.
- Monostable and bistable start at `X` ("as previously established" is undefined at power-on)
  until the first trigger or reset (Q4). Astable starts high, because the capacitor is empty.
- Every output edge comes `tPD` = 225 ns after its cause. That value is read off TI's Figure 5-8
  at 25 °C, with the trigger pulse going down to 0 V.

## Consequences

- The schematic carries the real component values (the BOM), and changing `rb` acts like
  turning Ben's potentiometer, through a recompile with carry-over. The resistors and the
  capacitor themselves are not drawn.
- Analog effects are not modeled: supply-dependent timing, CONT modulation, trigger pulse
  shape, the 10 µs minimum pulse.
- The same pattern serves other analog-timed parts (556, CMOS 555s, RC reset circuits): the
  network as props, the pins it occupies not simulated.
- Follow-ups (backlog): resistors, capacitors and potentiometers as drawn, unsimulated parts; a
  555 that reads R and C from them; turning a potentiometer with the Interact tool.

## Alternatives considered

- **Times as props** (high and low time, pulse width, as `io/clock`): simpler, but the
  schematic would not record the build's R and C. Rejected by the user (Q1).
- **Analog R and C parts read by the 555 from the netlist**: the most faithful schematic, but it
  needs analog netlist analysis or a mixed-signal kernel. Out of scope for a digital simulator.
- **A clock or pulse part without the 555 pinout** (`io/clock` plus buttons): no pinout to wire
  the way the breadboard is wired, so it fails "test before fab" for the clock module.
- **Every pin always an input**: in astable mode TRIG and THRES are on the capacitor and would
  float, so design checks would warn about pins that are not logic at all.
