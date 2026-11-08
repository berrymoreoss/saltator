# SAP-1

Track `SAP` of the [roadmap](../roadmap.md).

**Goal:** M3 "SAP-1 runs" — Ben Eater's 8-bit breadboard computer, built from modules that each
pass their own test bench, runs a program, verified by a test bench. The designs are example
documents in `examples/`.

**Not here:** parts and tools the build turns out to need — items in [Parts](parts.md) and
[Platform](platform.md), named in `Needs`.

## Items

| ID   | Branch                  | Title                 | Needs            | Status  |
| ---- | ----------------------- | --------------------- | ---------------- | ------- |
| R16a | `example/sap-1-modules` | SAP-1 modules         | R11a, R12a, R15a | next    |
| R16b | `example/sap-1`         | SAP-1 reference build | —                | planned |

## R16a · SAP-1 modules — `example/sap-1-modules`

Ben Eater's SAP-1 modules, each a subcircuit with its own test bench: clock, A and B registers,
ALU, program counter, RAM and memory address register (on a 6116 or 62256), output register
with its multiplexed EEPROM decoder. The existing Clock Module, SAP-1 A Register and SAP-1
Program Counter examples are redone as subcircuits.

## R16b · SAP-1 reference build — `example/sap-1`

Full Ben Eater 8-bit computer from R16a's modules (control logic with microcode EEPROMs,
7-segment output), with a test bench whose setup loads a demo program into the RAM and checks
what it outputs.
