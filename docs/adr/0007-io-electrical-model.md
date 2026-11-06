# 0007. IO parts model real contacts and two-terminal LEDs

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R03 (feat/io-basic)

## Context

The IO parts (rails, switches, buttons, DIP switches, pull resistors, LEDs, displays, a clock, a
probe) are how a learner pokes at a circuit and sees what it does. The vision asks for the bugs
of a breadboard build to show up in the simulator, and floating CMOS inputs are among the most
common ones: a button between VCC and a gate input without a pull-down works "sometimes". A
Logisim-style input pin that always drives 0 or 1 hides that bug; a Logisim-style LED with one
input can't be sunk by an active-low output or multiplexed. The kernel is purely digital, so the
model has to stay within drives, strengths and levels: no resistive or bidirectional switch
connections.

## Decision

- **Contacts are real.** Switches, buttons and DIP switches have a `contact` prop: `spdt`
  changes over between the rails (always drives 0 or 1, pin `out`); `spst-vcc` / `spst-gnd`
  close onto one rail and release the net when open (pin `tristate`), so they need a pull
  resistor, as on a breadboard. Defaults follow the real part: toggle switch SPDT, push button
  and DIP switch SPST to VCC. A missing pull resistor shows up where it matters: as a
  `floating-input` diagnostic on the CMOS input that reads the net.
- **LEDs have an anode and a cathode** (`A`, `K`), lit while A = 1 and K = 0; LED bars likewise;
  7-segment displays have segment pins and a common pin (`COM`) whose role depends on common
  anode / common cathode. The series resistor is implied.
- **Indicator pins only observe** (`PinDef.sense`): an LED, display or probe on a floating net
  is dark, not a floating CMOS input — no `floating-input`, no `undriven-input`.
- **Rails and constants are tied outputs** (`PinDef.constant`): design checks count outputs
  tied to the same level as one source, so VCC wired to VCC is fine and VCC to GND is a short.
  Each rail symbol is its own source; joining all VCC symbols by name belongs to net labels
  (R10).
- **Indicators record on-time**: per light, what it shows and how long it has been on, so a
  renderer shows a multiplexed display or an LED on a fast clock at its real average brightness.

Details: [components.md](../components.md#io-parts-io).

## Consequences

- Schematics map 1:1 to the breadboard: pull resistors, cathodes to GND and common pins are
  wired as in the real build, and forgetting one behaves like the real circuit.
- More wiring than in Logisim for simple experiments; the `spdt` contact (the default for the
  toggle switch) keeps the simplest circuits resistor-free.
- Two small kernel/definition additions (`sense`, `constant`) that later parts can use (bus
  probes, logic analyzer inputs, more power symbols).
- Contact bounce is not modelled yet (backlog); buttons switch cleanly at the action time.

## Alternatives considered

- **Logic sources (Logisim)**: switches and buttons always drive 0/1, an LED has one input and
  lights on 1. Less wiring, but floating inputs around switches can't happen and LEDs can't be
  sunk or multiplexed — the opposite of "test before fab".
- **Bidirectional switches that merge nets while closed** (as in hneemann's Digital): the most
  faithful, but needs nets that change at run time, a deep kernel change for little gain in
  digital builds.
- **Exempting LEDs from diagnostics by part type**: design checks and the kernel would need to
  know part types; a pin flag keeps them generic.
