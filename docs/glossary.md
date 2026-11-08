# Glossary

**Active low** — a pin that is asserted at logic 0 (`OE`, `CE`, `WE`); drawn with an overline or
bubble.

**Access time (tACC, tAA)** — how long after a new address a memory's outputs carry the data;
a data sheet gives only its guaranteed maximum. Before it, the simulator shows the outputs as
`X` (after a short hold time `tOH` of the old data): sampling a memory sooner is a bug.

**Address counter (AC)** — the HD44780's pointer into its display or character RAM: an
address set loads it, each data read or write moves it one up or down (the cursor follows it).
A busy-flag read gives it out with the busy flag.

**Astable / monostable / bistable** — the three ways to wire a 555 timer: a free-running
oscillator (the clock of a breadboard computer), one pulse of a fixed width per trigger (a
debounced step button), or a set/reset latch (a debounced switch). The RC network sets the times:
tH = 0.693 (RA + RB) C, tL = 0.693 RB C, tw = 1.1 RA C.

**BCD (binary-coded decimal)** — a decimal digit 0–9 in 4 bits (`0101` = 5); the 74HC4511 decodes
it for a 7-segment display and blanks the six codes above 9.

**Bidirectional pin (bidir)** — a pin that can read or drive the net depending on the part's state
(RAM data pins, 74HC245 A/B ports, CPU data bus).

**Bus** — several signals that belong together, drawn as one heavy bus line (a data bus
`D[0..7]`, an address bus `A[0..15]`). Here, as in KiCad, a bus is a group of ordinary nets named
by its members (`D0`…`D7`): a bus label names the bus line, bus entries lead single bits off it.
The bus line itself carries no level, only the value of its members (`0x3F`).

**Bus entry** — the short 45° stub where one bit leaves a bus line towards a pin
(`net/bus-entry`); it carries its member's name (`D3`) and joins that net like a net label.
Logisim's splitter and other tools' "bus ripper" do the same for several bits at once.

**Busy flag (BF)** — the HD44780's "still executing" bit, read on DB7 with RS = 0 and R/W̅ = 1:
1 for 37 µs after most instructions, 1.52 ms after Clear display and Return home. An instruction
sent while it is 1 is not accepted; programs either poll it or wait longer than the execution
time.

**Bus contention** — two or more strong drivers forcing different levels on one net. On real
hardware it causes excess current and undefined levels; the simulator reports a `contention`
diagnostic and resolves the net to `X`.

**Breakpoint** — a condition on signals (the trigger's terms: an edge, levels, bus values) that
pauses the run at every instant it holds anew, as a debugger stops a program on a line; a hit
count makes it stop from its n-th hit on (R14). **Break on errors** pauses at every contention
or timing violation instead.

**CGROM / CGRAM** — the HD44780's character generator: the ROM holds the 5 × 8 (and 5 × 10)
dot patterns of character codes 0x10–0xFF (ROM code A00: ASCII and katakana; A02: European), the
RAM eight user-defined patterns for codes 0x00–0x07.

**Carry-over** — continuing a running simulation in a recompiled netlist after an edit: unchanged
parts keep their state, outputs, pending changes and timers (matched by designator, through
renames), so the run goes on as if nothing happened (`Simulator.carryOver`).

**Common anode / common cathode** — the two kinds of LED displays: all segment anodes (or
cathodes) joined into one common pin (`COM`). Common cathode: a segment lights when its pin is 1
and COM is 0; common anode: when its pin is 0 and COM is 1.

**Dangling wire** — a wire end that touches nothing (no pin, no other wire); usually a wire that
stops one grid cell short of a pin. Reported as a design-check warning.

**DDRAM** — the HD44780's display data RAM: 80 character codes, two lines of 40 at addresses
0x00 and 0x40 (one line of 80 in 1-line mode); the glass shows a window of it, which the
display shift moves.

**Datasheet function table** — the truth table in a chip's datasheet; the basis of every part test.
Real chips carry it as data (`functionTable`, columns with the data sheet's generic names such as
`nA nB | nY`), shown in the Part tab.

**Design** — the top circuit with every subcircuit instance expanded into one flat netlist, which
the simulator runs (`compileDesign`): inner parts by instance path (`A1/U3`), nets joined
through ports. The kernel never sees the hierarchy.

**Enable / disable time (ten, tdis)** — how long a 3-state output takes to start driving after
its enable becomes active (`ten`, tPZH/tPZL) and to release the net after it becomes inactive
(`tdis`, tPHZ/tPLZ). When `tdis > ten`, two outputs handing a bus over at one instant fight
briefly.

**Cursor (waveforms)** — a vertical marker in the timing diagram (`A`, `B`) placed on an instant,
snapping to edges; the time between them (Δt) and its frequency are read in the toolbar.

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

**Debug setup** — the debugger's breakpoints, watches, step clock and Run For duration, kept
with the browser tab's session, not in the file (R14).

**Drive / strength** — what an output contributes to a net: a level plus a strength (`none`,
`weak`, `strong`). Pull resistors are weak; CMOS outputs are strong.

**EEPROM** — electrically erasable programmable read-only memory (AT28C16, AT28C256): keeps
its contents without power and is written byte by byte in a slow, self-timed write cycle. Here
EEPROMs are read as ROMs; their contents (the image) are saved with the circuit.

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

**HD44780** — Hitachi's character LCD controller (HD44780U; clones: ST7066U, KS0066, SPLC780):
on nearly every 16 × 2 and 20 × 4 text display module, driven over RS, R/W̅, E and an 8- or
4-bit data bus (`periph/hd44780`).

**Instance path** — where a part or net sits in the hierarchy: designators of instances from the
top down, then the inner name (`A1/A2/U1.Y`, `A1/CLK`). How the Waveforms tab, watches,
breakpoints and the Memory tab name things inside subcircuits.

**Interact tool** — the tool that operates parts while simulating: flip a switch or DIP switch,
hold a push button, step a manual clock (`I`; Run selects it).

**Image (memory image)** — the contents of a ROM, as a programmer writes them into the chip.
Saved in the circuit as sparse hex runs: `0000:A9FF8D` is three bytes from address 0; bytes not
listed are erased (`0xFF`).

**Intel HEX** — a text format for memory images: lines (records) of `:`, a byte count, a 16-bit
address, a record type and the data in hex, ending in a checksum (`:048000000102030472` writes
four bytes at 0x8000). Extended address records reach beyond 64 KB; an end-of-file record closes
it. Assemblers and EEPROM programmers read and write it, as the Memory tab does.

**Inertial delay** — a delay model in which input pulses shorter than the element's delay do not
reach the output.

**Junction** — a point where three or more wires/pins meet and connect, drawn with a dot. A wire
end landing on the middle of another wire (T-junction) connects; two wires that merely cross do
not.

**Level** — the resolved value of a net as seen by readers: `0`, `1`, `X` (unknown) or `Z`
(high impedance / floating).

**Memory inspector** — the Memory tab: a hex view of a memory part's cells, live while
simulating, with the cells just read (green) and written (orange) lit and the address on the
chip's pins outlined; bytes are edited in place, and image files loaded and saved.

**Metastability** — what a flip-flop may do when its data changes too close to the clock edge:
hover between 0 and 1 for a while and then fall either way. The simulator doesn't model the
analog behavior; it reports the timing violation and makes the bit `X` (ADR-0014).

**Multiplexing (displays)** — driving several digits over shared segment lines by enabling one
digit's common pin at a time, fast enough that the eye sees all digits lit (persistence of
vision), each at the fraction of time it is enabled.

**Logic family** — chips with the same numbers but a different technology: 74HC (CMOS), 74HCT
(CMOS with TTL input levels), 74LS (TTL), 74AC. Same pinout and function, different timing and
input behavior; the library shares the function and takes timing from the family.

**Nibble / 4-bit interface** — half a byte. An HD44780 in 4-bit mode takes each byte as two
transfers on DB7–DB4, high nibble first, saving four wires; the module keeps the phase, so a
CPU reset between the two leaves it out of step until the data sheet's 0x3, 0x3, 0x3, 0x2
sequence brings it back.

**n.c. (not connected)** — a package pin with no function (74HC20 pins 3 and 11), named
`NC<number>` in a definition and drawn `NC`.

**Net** — a set of electrically connected pins; all of them see the same level.

**Netlist** — the flat list of component instances and nets the kernel simulates.

**Net label** — a named flag on a wire end or pin tip (`net/label`); all labels with the same
name are one net, so distant parts connect without a wire between them (KiCad/Altium "net
label", Logisim "tunnel"). The VCC and GND symbols join the nets `VCC` and `GND` the same way.
Drawn and connected but never simulated (schematic-only). Not to be confused with a part's
`label`, which is display text only. Named like a bus (`D[0..7]`) it is a **bus label**: it sits
on a bus line and names that bus.

**Part / component** — a simulated device: a real chip (`74xx/74hc00`), an IO element
(`io/led`), or an abstract primitive (`prim/nand`).

**On-time / brightness** — how long an indicator's light has been on; its share of a frame is
the brightness drawn, so a multiplexed display or an LED on a fast clock shows its average.

**Open instance** — the instance of the open circuit the canvas shows (`EditorState.path`,
R11b): its levels drawn while simulating, the Interact and Probe tools acting on its parts. The
breadcrumb bar over the canvas shows where it is (`Main › A2 · Counter Digit`).

**Port** — a subcircuit's interface pin (KiCad's hierarchical label): a flag named like a net
(or a bus, `D[0..7]`) inside the circuit, a pin of that name on every instance of it. Its
direction shapes the flag and the instance symbol's side; electrically it is a plain connection.

**Propagation delay (tpd, tPLH, tPHL)** — time from an input change to the resulting output
change; tPLH for low→high, tPHL for high→low output transitions. MSI chips give one per **delay
path** (74HC138: `An to Yn`, `E3 to Yn`); several inputs changing at once take the longest.

**Priority encoder** — the reverse of a decoder: the number of the highest-numbered active input
(74HC148: 8 inputs → 3 bits; 74HC147: 9 inputs → BCD, all inactive meaning 0).

**Pull-up / pull-down** — a resistor that weakly drives a net to 1 / 0 when nothing else drives it.

**Programmer (EEPROM programmer)** — the device that writes an image into an EEPROM before it
goes into the board (a TL866, Ben Eater's Arduino programmer): it erases the chip, writes the
file's bytes, and shows the file's range and checksum. The Memory tab's Load dialog plays its
part.

**Probe** — a signal shown in the Waveforms tab: a net, pin or bus named by a resolver
reference (`CLK`, `U1.Y`, `D[0..7]`), or a group of single signals read as one value; saved in
the circuit (R13). The Probe tool (`P`) adds one with a click. Not to be confused with the logic
probe part (`io/probe`, `TP`), which shows a level on the canvas.

**Recorder** — what keeps the probed nets' levels over simulated time for the waveforms (core
`Recorder`, R13): one level per instant, the oldest changes dropped past a budget.

**Run statistics** — counters of a run (events, delta cycles, evaluations, simulated and wall
time, their rates) since power-on and for the last run, and on request the nets that change
most (R14, the Simulation tab).

**Recovery time (trec)** — how long an asynchronous set or reset must have been released before
the next clock edge acts; an earlier edge may or may not load.

**Ripple counter** — a counter whose flip-flops clock each other (Q of one is the clock of the
next): cheap, but its outputs change one after another, passing through wrong values (a
74HC107 chain going 15 → 0 shows 14, 12, 8 on the way, 19 ns apart; a 74HC4040 ripples 10 ns
per stage). Gates decoding its outputs glitch.

**Sandbox** — where the app runs a document's test script (R15b): a Worker inside an
opaque-origin iframe whose policy allows no network, so a script reaches neither the app's
storage nor anything outside; Cancel and the time limits end it.

**Script host** — where a test script's text becomes code (R15a): a `node:vm` context in Node
(`pnpm test:circuits`), `new Function` in a trusted realm, inside the app's sandbox (R15b).

**Subcircuit (instance)** — a circuit of the document placed inside another, drawn as a box whose
pins are its ports (`A1`, `A2`: IEEE 315's `A` for an assembly). Every instance has its own
parts and state; editing the circuit changes them all. A module of a breadboard computer.

**Synchronous counter** — a counter whose flip-flops all take the same clock edge, so its
outputs change together (74HC161, 163, 191, 193); it can load a value (**parallel load**) and
count only when enabled. Its **terminal count** output (TC) signals the last state (15 counting
up, 0 counting down) so the next counter in a cascade counts on.

**SRAM** — static RAM (6116, 62256): keeps its contents only while powered, reads and writes
at full speed. A write happens while chip select and write enable are both LOW; the cell takes
the data present when the first of them rises. It powers on with unknown contents.

**Speed grade** — the same memory chip sold with different guaranteed access times, marked in
its part number (6116SA**15**, AT28C256-**15**). Slower grades are the safer assumption.

**Shift register** — flip-flops in a chain on one clock, each taking the one before it: bits go
in one at a time and come out side by side (74HC164, 595), or go in side by side and come out one
at a time (74HC165). The 74HC595 adds a **storage register** (output latch): the shifted bits
appear on its outputs only when its second clock copies them, so the LEDs don't flicker while
shifting.

**Johnson counter** — a shift register whose inverted last stage feeds its input: it fills with
ones, then with zeros, 2n states for n stages (the Shift Register LEDs example).

**Resolver** — what turns a reference (`U5`, `U5.A0`, `CLK`, `D[0..7]`, inside instances
`A1/U3.Q0`) into the compiled design's part, pin, net or bus; one place for the memory
inspector, probes, watches and test benches.

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

**Step Clock** — the debugger's step by one clock cycle: the run goes on through the step
clock's next active edge and pauses right before the one after, the cycle settled (the kernel
sees the edge coming: `stopBefore`); a manual clock gets one pulse instead (R14). **Run For** and
**Run To** step by time.

**Rewind** — going back to an earlier instant of a run and seeing the circuit as it was then
(R14b): the simulator restores the **checkpoint** (a **snapshot** of its whole state, taken
every so often while it runs) before that instant and re-runs from it with the user's actions,
deterministically, in a **replica** the tools don't watch. The **timeline** is that history —
checkpoints and the action log — since power-on or the last edit; the **present** is the
furthest the run got. Behind the present, running forward **replays** the recording (the same
actions again, to the same present); acting there starts a new future.

**Step Back / Step Back Clock / Reverse Continue** — the debugger's steps backwards (R14b): to
the instant something happened before the last one; to right before the step clock's last
active edge (undoing Step Clock); to the previous breakpoint hit or error. Alt + the forward
key: Alt+F10, Alt+F8, Alt+F5.

**Simulator host** — what runs the kernel against the wall clock in the app (`Simulation` in the
editor): run, pause, step, stop, reset, speed, frame budget, following edits.

**Test bench** — a harness that applies stimulus to a part or circuit and checks the outputs over
time. A circuit's benches (R15a) run it as the top through its ports or switches, in fixed
steps (inputs at the start, a clock pulse from ¼ to ¾, checks at the end); a part's (core's
`Bench`) test one part from its data sheet.

**Test script** — a circuit's JavaScript in the document registering its test benches with
`bench(name, (b) => …)` (R15a); `pnpm test:circuits` runs them headless, the Tests tab in the
app (R15b).

**Test vector** — one row of a test bench table: inputs to apply and outputs expected
(`` b.table`A B | Y …` ``, `b.row`).

**Top circuit** — the document's first circuit, starred in the Circuits list: the one that
simulates, with every instance in it flattened. Set as Top Circuit makes another one the top.

**Trigger** — a condition that catches a moment in a run, as on a logic analyzer: levels and
bus values ANDed with at most one edge; when it fires, the run goes on for the rest of the
capture window and pauses (R13). Also the instant it fired (`T` in the diagram).

**Tri-state output** — an output that can drive 0, 1, or be disabled (high impedance `Z`), allowing
several outputs to share a bus.

**VCD (Value Change Dump)** — the text format of IEEE 1364 for signal changes over time, read by
GTKWave, Surfer, PulseView and HDL tools; the Waveforms tab exports one (R13).

**Watch** — a value the Debug tab shows at every stop — a signal, a bus, a group of single
signals or memory cells (`U5[1F]`) — marked when it changed since the last stop (R14).

**Waveform / timing diagram** — signals drawn against time, one row each, as the Waveforms tab
and data sheets' timing figures show them; cursors (`A`, `B`) measure the time between edges.

**Workbench** — the application window: menu bar, toolbar, docked panels (Parts, Properties,
Messages), canvas and status bar.

**Unit (gate section)** — one of several identical functions inside a chip (the four NAND gates of
a 74HC00), drawn separately in symbol view.

**SAP-1** — "Simple As Possible" computer from Malvino's textbook, built on breadboards by Ben
Eater as his 8-bit computer series.

**BE6502** — Ben Eater's 6502 breadboard computer (65C02, 28C256 EEPROM, 62256 SRAM, 65C22 VIA,
HD44780 LCD).
