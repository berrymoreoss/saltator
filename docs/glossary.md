# Glossary

**Active low** — a pin that is asserted at logic 0 (`OE`, `CE`, `WE`); drawn with an overline or
bubble.

**Astable / monostable / bistable** — the three ways to wire a 555 timer: a free-running
oscillator (the clock of a breadboard computer), one pulse of a fixed width per trigger (a
debounced step button), or a set/reset latch (a debounced switch). The RC network sets the times:
tH = 0.693 (RA + RB) C, tL = 0.693 RB C, tw = 1.1 RA C.

**BCD (binary-coded decimal)** — a decimal digit 0–9 in 4 bits (`0101` = 5); the 74HC4511 decodes
it for a 7-segment display and blanks the six codes above 9.

**Bidirectional pin (bidir)** — a pin that can read or drive the net depending on the part's state
(RAM data pins, 74HC245 A/B ports, CPU data bus).

**Bus contention** — two or more strong drivers forcing different levels on one net. On real
hardware it causes excess current and undefined levels; the simulator reports a `contention`
diagnostic and resolves the net to `X`.

**Carry-over** — continuing a running simulation in a recompiled netlist after an edit: unchanged
parts keep their state, outputs, pending changes and timers (matched by designator, through
renames), so the run goes on as if nothing happened (`Simulator.carryOver`).

**Common anode / common cathode** — the two kinds of LED displays: all segment anodes (or
cathodes) joined into one common pin (`COM`). Common cathode: a segment lights when its pin is 1
and COM is 0; common anode: when its pin is 0 and COM is 1.

**Dangling wire** — a wire end that touches nothing (no pin, no other wire); usually a wire that
stops one grid cell short of a pin. Reported as a design-check warning.

**Datasheet function table** — the truth table in a chip's datasheet; the basis of every part test.
Real chips carry it as data (`functionTable`, columns with the data sheet's generic names such as
`nA nB | nY`), shown in the Part tab.

**Enable / disable time (ten, tdis)** — how long a 3-state output takes to start driving after
its enable becomes active (`ten`, tPZH/tPZL) and to release the net after it becomes inactive
(`tdis`, tPHZ/tPLZ). When `tdis > ten`, two outputs handing a bus over at one instant fight
briefly.

**Delta cycle** — a sub-step at the same simulation time, used to propagate zero-delay changes in
a deterministic order.

**Design check** — a static check of a circuit before simulation (unknown part, shorted outputs,
undriven input, dangling wire). Errors may block simulation; warnings don't.

**Designator** — the reference name of a part on a schematic (`U1`, `SW1`, `D3`). In this
simulator it is the component's id in the document, the netlist and diagnostics. Its letters are
the part's **designator prefix** (KiCad/IEEE convention: `U` chips and gates, `R` resistors, `SW`
switches, `D` LEDs, `DS` displays, `X` clocks, `TP` probes, `PWR` power symbols), set in the part
definition; new parts take the lowest free number.

**DIP** — dual in-line package; the through-hole chip package used on breadboards. Pin 1 is next
to the notch, numbering runs counter-clockwise (seen from the top).

**Document session** — the open document around the editor's circuit: its name, the file it
was opened from or saved to, and the circuit as last saved, against which unsaved changes are
measured. Autosaved per browser tab and restored after a reload (R07).

**Drive / strength** — what an output contributes to a net: a level plus a strength (`none`,
`weak`, `strong`). Pull resistors are weak; CMOS outputs are strong.

**Flip-flop / register** — a circuit that stores one bit and takes a new value only on a clock
edge (74HC74, 107, 109, 112); a register is several flip-flops on one clock (74HC173, 273, 574).
A JK flip-flop holds, resets, sets or toggles depending on J and K.

**Floating input** — an input connected to a net that nothing drives (`Z`). On CMOS parts it reads
randomly and may oscillate; the simulator treats it as `X` and reports it.

**Floating paste** — pasted or duplicated parts and wires that follow the pointer as ghosts
(translucent previews) until a click drops them.

**Gate style** — how logic gates are drawn: ANSI/IEEE 91 distinctive shapes (the D-shaped AND,
the curved OR) or IEC 60617 rectangles with a qualifying symbol (`&`, `≥1`, `=1`). A view setting
in the editor; the pins are the same either way.

**Interact tool** — the tool that operates parts while simulating: flip a switch or DIP switch,
hold a push button, step a manual clock (`I`; Run selects it).

**Inertial delay** — a delay model in which input pulses shorter than the element's delay do not
reach the output.

**Junction** — a point where three or more wires/pins meet and connect, drawn with a dot. A wire
end landing on the middle of another wire (T-junction) connects; two wires that merely cross do
not.

**Level** — the resolved value of a net as seen by readers: `0`, `1`, `X` (unknown) or `Z`
(high impedance / floating).

**Metastability** — what a flip-flop may do when its data changes too close to the clock edge:
hover between 0 and 1 for a while and then fall either way. The simulator doesn't model the
analog behavior; it reports the timing violation and makes the bit `X` (ADR-0014).

**Multiplexing (displays)** — driving several digits over shared segment lines by enabling one
digit's common pin at a time, fast enough that the eye sees all digits lit (persistence of
vision), each at the fraction of time it is enabled.

**Logic family** — chips with the same numbers but a different technology: 74HC (CMOS), 74HCT
(CMOS with TTL input levels), 74LS (TTL), 74AC. Same pinout and function, different timing and
input behavior; the library shares the function and takes timing from the family.

**n.c. (not connected)** — a package pin with no function (74HC20 pins 3 and 11), named
`NC<number>` in a definition and drawn `NC`.

**Net** — a set of electrically connected pins; all of them see the same level.

**Netlist** — the flat list of component instances and nets the kernel simulates.

**Net label** — a named flag on a wire end or pin tip (`net/label`); all labels with the same
name are one net, so distant parts connect without a wire between them (KiCad/Altium "net
label", Logisim "tunnel"). The VCC and GND symbols join the nets `VCC` and `GND` the same way.
Drawn and connected but never simulated (schematic-only). Not to be confused with a part's
`label`, which is display text only.

**Part / component** — a simulated device: a real chip (`74xx/74hc00`), an IO element
(`io/led`), or an abstract primitive (`prim/nand`).

**On-time / brightness** — how long an indicator's light has been on; its share of a frame is
the brightness drawn, so a multiplexed display or an LED on a fast clock shows its average.

**Propagation delay (tpd, tPLH, tPHL)** — time from an input change to the resulting output
change; tPLH for low→high, tPHL for high→low output transitions. MSI chips give one per **delay
path** (74HC138: `An to Yn`, `E3 to Yn`); several inputs changing at once take the longest.

**Priority encoder** — the reverse of a decoder: the number of the highest-numbered active input
(74HC148: 8 inputs → 3 bits; 74HC147: 9 inputs → BCD, all inactive meaning 0).

**Pull-up / pull-down** — a resistor that weakly drives a net to 1 / 0 when nothing else drives it.

**Recovery time (trec)** — how long an asynchronous set or reset must have been released before
the next clock edge acts; an earlier edge may or may not load.

**Ripple counter** — a counter whose flip-flops clock each other (Q of one is the clock of the
next): cheap, but its outputs change one after another, passing through wrong values (a
74HC107 chain going 15 → 0 shows 14, 12, 8 on the way, 19 ns apart; a 74HC4040 ripples 10 ns
per stage). Gates decoding its outputs glitch.

**Synchronous counter** — a counter whose flip-flops all take the same clock edge, so its
outputs change together (74HC161, 163, 191, 193); it can load a value (**parallel load**) and
count only when enabled. Its **terminal count** output (TC) signals the last state (15 counting
up, 0 counting down) so the next counter in a cascade counts on.

**Shift register** — flip-flops in a chain on one clock, each taking the one before it: bits go
in one at a time and come out side by side (74HC164, 595), or go in side by side and come out one
at a time (74HC165). The 74HC595 adds a **storage register** (output latch): the shifted bits
appear on its outputs only when its second clock copies them, so the LEDs don't flicker while
shifting.

**Johnson counter** — a shift register whose inverted last stage feeds its input: it fills with
ones, then with zeros, 2n states for n stages (the Shift Register LEDs example).

**Rubber-banding** — wires following a part as it is moved, rotated or flipped: they stretch,
slide a corner or bend, so connections are kept.

**Sense pin** — an input that only observes its net (LEDs, displays, probes). Reading a floating
net through it is not a mistake, so it never raises a floating-input diagnostic.

**Setup / hold time (tsu, th)** — how long data must be stable before / after a clock edge for a
flip-flop to capture it reliably. Data sheets give a typical value and a guaranteed minimum; the
timing checks use the minimum and report a `setup-violation` / `hold-violation`.

**Pulse width (tW)** — the shortest HIGH or LOW phase a clock (or a set/reset pulse) may have;
together the two phases bound the clock frequency (`fmax`).

**Timing check** — a part checking the circuit against its data sheet's timing requirements
(set-up, hold, pulse width, recovery) while simulating; a violation is an error in the
Simulation tab and makes the affected bits unknown.

**SPST / SPDT** — single-pole single-throw (a contact that closes onto one terminal, open
otherwise: push buttons, DIP switches) / single-pole double-throw (a changeover between two
terminals: slide and toggle switches). An SPST contact to a rail leaves the net floating when
open, so it needs a pull resistor. A changeover can also have its common on a rail and its two
throws as the outputs (`io/switch` `spdt-gnd`: `ON`, `OFF`), as Ben Eater's bistable 555 uses.

**Symbol** — how a part that isn't drawn as a chip package looks on the schematic (LED, switch,
gate shape). Parts describe it as data (body size, pin sides and offsets); the editor draws it.

**Stub (pin stub)** — the short line from a part's body to the pin's connection point, where a
wire must end to connect.

**Simulator host** — what runs the kernel against the wall clock in the app (`Simulation` in the
editor): run, pause, step, stop, reset, speed, frame budget, following edits.

**Test bench** — a harness that applies stimulus to a part or circuit and checks the outputs over
time.

**Test vector** — one row of a test bench table: inputs to apply and outputs expected.

**Tri-state output** — an output that can drive 0, 1, or be disabled (high impedance `Z`), allowing
several outputs to share a bus.

**Workbench** — the application window: menu bar, toolbar, docked panels (Parts, Properties,
Messages), canvas and status bar.

**Unit (gate section)** — one of several identical functions inside a chip (the four NAND gates of
a 74HC00), drawn separately in symbol view.

**SAP-1** — "Simple As Possible" computer from Malvino's textbook, built on breadboards by Ben
Eater as his 8-bit computer series.

**BE6502** — Ben Eater's 6502 breadboard computer (65C02, 28C256 EEPROM, 62256 SRAM, 65C22 VIA,
HD44780 LCD).
