# 0016. Buses are named groups of nets on their own layer

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R10b (feat/buses)

## Context

An 8-bit computer's schematic has a data bus and an address bus touching most chips; drawn as
single wires they are unreadable. Schematic editors draw a bus as one heavy line, but disagree
on what it is. In KiCad a bus is a group of nets named by its members (`D[0..7]` → `D0`…`D7`):
bus entries lead single wires off it and the wires' names make the connections. In Logisim a
wire has a bit width, and a splitter joins bit `i` of a bundle to its `i`-th fan-out end. Every
part here has one-bit pins (DIP chips, ADR-0004), net names exist since R10a (ADR-0015, `[ ]`
kept for bus ranges), and the logic analyzer (R13) and a KiCad export (backlog) will need bus
names. The roadmap left the model to this item.

## Decision

- **A bus is a group of ordinary nets named by its members**, KiCad's vector bus: `D[0..7]` has
  the members `D0`…`D7` (`BUS_NAME`, `busMembers` in core: a net name as the stem, indices
  0…99 either way round, at most 32 characters). The kernel and the netlist don't know buses;
  a bus carries no level, only its members' value (`0x3F`, with `X`/`Z` nibbles).
- **Bus lines are wires with a flag** (`Wire.bus`, document schema v2). **They are a layer of
  their own**: bus lines connect only to bus lines and to bus pins (`PinDef.bus`), by the same
  geometric rules as wires; wires and other pins never connect to them. The compiler runs
  connectivity once per layer (`CompileResult.buses`). The editor draws them with a Bus tool
  (`B`) or out of bus pins, and moves and normalizes each layer on its own.
- **Bus labels are net labels with a bus name**: one `net/label` part whose pin is a bus pin
  when its name is a bus name; bus labels of one name join every bus of that name.
- **Bus entries carry their member's name** (`net/bus-entry`, `D0` → `D1` when placed): the bit
  end joins that net by name like a net label, the bus end sits on a bus line. An entry whose
  name isn't a member of its named bus is a `bus-entry-member` warning.
- **One bit per entry.** No multi-bit ripper for now.
- **Values on the bus labels** while simulating; Properties lists a bus's bits.

Details: [circuit.md](../circuit.md#buses), [components.md](../components.md#net-labels-net),
[editor.md](../editor.md#live-drawing).

## Consequences

- Editing buses never changes the netlist: a running simulation goes on untouched unless an
  entry's bit connection changes (then the usual carry-over, ADR-0010).
- A wire touching a bus connects to nothing there; the `dangling-wire` warning says to use a
  bus entry. A stray wire can't merge two nets through a bus.
- Bus members are found by name: a label `D3` on a chip pin is a member of `D[0..7]` without
  touching the bus line, and a member nothing is named after reads `Z`.
- Files from before R10b open unchanged (an identity migration); files with buses don't open in
  older versions, which reject schema v2.
- Placing entries by their bit end on a chip's adjacent pins is as quick as a ripper, and gaps
  in a pinout (the 28C16's GND between D2 and D3) need nothing special.

## Alternatives considered

- **Width-indexed wires and splitters** (Logisim) — no names to type, but multi-bit nets the
  compiler must expand, width inference and mismatch errors, and every one-bit chip pin still
  needs a splitter; the analyzer and a KiCad export would need names anyway.
- **Bus lines inferred from what they touch** (one Wire tool; a wire touching a bus label or
  entry becomes a bus) — no schema change, but a stray wire merges into the bus and joins
  unrelated nets; the error comes after the damage.
- **Bus lines as a separate document array** — every wire feature (selection, moves, clipboard,
  undo, normalization) would need a second list; a flag reuses them with a layer filter.
- **Entries deriving their bit from the bus and an index** — moving an entry to another bus
  would rebind it, but compiling needs two passes and the entry's drawn name would depend on
  the bus; a named entry is explicit, and the member check catches a mismatch.
- **A multi-bit ripper** (one part, N bit pins at 1-cell pitch) — flush against eight adjacent
  pins, but a gap in a pinout needs two; single entries placed down the pins are as quick. Kept
  in the backlog.
