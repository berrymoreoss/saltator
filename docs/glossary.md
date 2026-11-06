# Glossary

**Active low** — a pin that is asserted at logic 0 (`OE`, `CE`, `WE`); drawn with an overline or
bubble.

**Bidirectional pin (bidir)** — a pin that can read or drive the net depending on the part's state
(RAM data pins, 74HC245 A/B ports, CPU data bus).

**Bus contention** — two or more strong drivers forcing different levels on one net. On real
hardware it causes excess current and undefined levels; the simulator reports a `contention`
diagnostic and resolves the net to `X`.

**Dangling wire** — a wire end that touches nothing (no pin, no other wire); usually a wire that
stops one grid cell short of a pin. Reported as a design-check warning.

**Datasheet function table** — the truth table in a chip's datasheet; the basis of every part test.

**Delta cycle** — a sub-step at the same simulation time, used to propagate zero-delay changes in
a deterministic order.

**Design check** — a static check of a circuit before simulation (unknown part, shorted outputs,
undriven input, dangling wire). Errors may block simulation; warnings don't.

**Designator** — the reference name of a part on a schematic (`U1`, `SW1`, `D3`). In this
simulator it is the component's id in the document, the netlist and diagnostics.

**DIP** — dual in-line package; the through-hole chip package used on breadboards. Pin 1 is next
to the notch, numbering runs counter-clockwise (seen from the top).

**Drive / strength** — what an output contributes to a net: a level plus a strength (`none`,
`weak`, `strong`). Pull resistors are weak; CMOS outputs are strong.

**Floating input** — an input connected to a net that nothing drives (`Z`). On CMOS parts it reads
randomly and may oscillate; the simulator treats it as `X` and reports it.

**Inertial delay** — a delay model in which input pulses shorter than the element's delay do not
reach the output.

**Junction** — a point where three or more wires/pins meet and connect, drawn with a dot. A wire
end landing on the middle of another wire (T-junction) connects; two wires that merely cross do
not.

**Level** — the resolved value of a net as seen by readers: `0`, `1`, `X` (unknown) or `Z`
(high impedance / floating).

**Net** — a set of electrically connected pins; all of them see the same level.

**Netlist** — the flat list of component instances and nets the kernel simulates.

**Part / component** — a simulated device: a real chip (`74xx/74hc00`), an IO element
(`io/led`), or an abstract primitive (`prim/nand`).

**Propagation delay (tpd, tPLH, tPHL)** — time from an input change to the resulting output
change; tPLH for low→high, tPHL for high→low output transitions.

**Pull-up / pull-down** — a resistor that weakly drives a net to 1 / 0 when nothing else drives it.

**Setup / hold time** — how long data must be stable before / after a clock edge for a flip-flop
to capture it reliably.

**Test bench** — a harness that applies stimulus to a part or circuit and checks the outputs over
time.

**Test vector** — one row of a test bench table: inputs to apply and outputs expected.

**Tri-state output** — an output that can drive 0, 1, or be disabled (high impedance `Z`), allowing
several outputs to share a bus.

**Unit (gate section)** — one of several identical functions inside a chip (the four NAND gates of
a 74HC00), drawn separately in symbol view.

**SAP-1** — "Simple As Possible" computer from Malvino's textbook, built on breadboards by Ben
Eater as his 8-bit computer series.

**BE6502** — Ben Eater's 6502 breadboard computer (65C02, 28C256 EEPROM, 62256 SRAM, 65C22 VIA,
HD44780 LCD).
