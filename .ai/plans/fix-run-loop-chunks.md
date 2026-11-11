# Plan: fix/run-loop-chunks

| Field      | Value                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| Branch     | `fix/run-loop-chunks`                                                   |
| Roadmap    | — (a fix found in HDL-7, [its plan](example-picorv32.md), Out of scope) |
| Status     | draft                                                                   |
| Depends on | HDL-7 merged (its example is the reproduction)                          |
| Created    | 2026-11-11                                                              |

## Goal

The app's run loop keeps its frame budget and reports the speed it really reaches with parts
whose events are expensive. Today, at Max, the Verilog PicoRV32 example gets ≈ 3 frames a second
and the status says "max 5 s/s" while the simulation advances ≈ 1.7 s a second.

## Scope

**In scope**

- `src/editor/simulation.ts`, the run loop (`#frame`): the kernel is called in chunks of
  `CHUNK_EVENTS` = 20 000 events and the frame budget (8 ms) is checked only between chunks. With
  PicoRV32 an event (a module evaluation) costs ≈ 50–70 µs: a chunk is ≈ 5 000 cycles, ≈ 0.35 s.
- The achieved rate: `rate = (sim.now − start) × 1000 / elapsed`, where `elapsed` is the wall time
  since the last frame capped at `MAX_FRAME_MS` (100 ms) — the cap is right for the real-time
  target (a backlog is dropped), wrong for the rate: 0.5 s simulated over a frame of ≈ 0.35 s
  read as 0.5 / 0.1 = 5 s/s.
- A regression test first (`src/editor/simulation.test.ts`, a fake clock and a part whose events
  advance the fake clock), then the fix.

**Out of scope**

- Making modules faster → HDL-10.

## Design

To decide at the start (ask): chunks sized from the measured cost of an event (events per ms,
averaged, so a chunk fits the remaining budget), or a fixed smaller chunk (e.g. 1 000 events)
with the kernel's per-call overhead measured on the kernel benchmark; the rate from the wall
time the frame's work really took.

## Tasks

- [ ] 1. Reproduce in a unit test (frame budget exceeded, rate overstated).
- [ ] 2. Fix the chunking and the rate; the kernel benchmark and the run loop's tests unchanged.
- [ ] 3. Look at the Verilog PicoRV32 example at Max in the browser: smooth frames, the status
  near the headless speed (≈ 1.4–1.7 s/s at 10 kHz).
- [ ] 4. Docs (ADR-0010 if its pacing text changes), lessons.

## Acceptance criteria

- [ ] `pnpm check`, `pnpm build`, `pnpm e2e` green.
- [ ] At Max with the PicoRV32 example a frame takes about the budget, and the status's rate
  matches the simulated time over wall time.

## Open questions

- [ ] Q1. Adaptive chunks or a fixed smaller chunk? — _proposed:_ adaptive.

## Progress log

- 2026-11-11 — pre-drafted in HDL-7 (example/picorv32), where the example showed it.

## Handoff

- **State:** draft; not started.
- **Next step:** `/start-branch fix/run-loop-chunks`.
- **Watch out:** the cap on `elapsed` must stay for the real-time target.
- **Verify with:** the Verilog PicoRV32 example at Max.
