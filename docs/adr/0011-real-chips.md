# 0011. Real chips: Nexperia data sheets, one function per chip, timing per family

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R06 (`feat/74hc-gates`)

## Context

R06 brings the first real chips (18 74HC gates and bus buffers). Several choices outlive the
branch:

- Pin names end up in test benches (R15), diagnostics and netlists; vendors name them
  differently (Nexperia `A0`–`A7`, `1A0`; TI `A1`–`A8`, `1A1`).
- Data sheets give delays under different conditions: Nexperia's typical `tpd` exists at 5 V /
  15 pF, but typical enable and disable times only at 2.0, 4.5 and 6.0 V with 50 pF.
- The same chip number exists in several logic families (74HC, 74HCT, 74LS, 74AC) with the same
  pinout and function but different timing (and, for TTL, input behavior).
- A learner wiring a chip needs what each pin does and the function table, not only the pin
  names drawn in the package.

## Decision

- **Source**: the Nexperia product data sheets for the 74HC family — pin names (0-based bus
  pins, like a computer's bus bits), pin descriptions, function tables and timing. Every chip
  cites document, revision and table (`timing.source`).
  _Amended in R08:_ chips Nexperia doesn't document (147, 148, 283) follow the current TI data
  sheets, with typical values from the Philips sheets where TI gives none at 4.5 V / 50 pF
  (docs/components.md#74xx-chips-74xx).
- **Timing**: every 74HC delay at VCC = 4.5 V, CL = 50 pF: the typical value at 25 °C drives the
  simulation, the maximum at −40 °C to +85 °C is recorded for a future worst-case mode.
- **Structure**: a chip's function (pinout, units, function table, behavior) is a `ChipSpec`
  shared by all families; a `LogicFamily` supplies each chip's data sheet and timing;
  `chipDefinition` combines them into `74xx/74hc00`.
- **Data sheet data on definitions**: `PinDef.description` and `ComponentDefinition.functionTable`
  (the data sheet's generic columns `nA nB | nY`, one unit; letters, plus display text such as
  `A=B`). The Part tab shows them; the tests check the behavior against the same table, mapping
  its columns to each unit through pin numbers transcribed separately from the pinning figure.
- **Behavior**: every section of a chip is re-evaluated on each call.

## Consequences

- Pin names are fixed now; changing vendor later would need a migration of test benches.
- One condition for every delay: relations inside a chip (`ten` vs `tpd`) and between chips are
  consistent; 74HC parts run about 20 % slower than with 5 V / 15 pF numbers.
- Adding a chip is a spec (transcribed table rows), a timing entry and tests; a new family is a
  timing table, except 74LS, which also needs a TTL input model.
- The function table is one source for the user and the tests; rows with display text (245) are
  checked by hand-written tests.
- Evaluating every section costs throughput (a 74HC04 chain ≈ 8.4M vs ≈ 13.2M events/s for
  `prim/not`); skipping sections would need the kernel to mark the forced evaluation.

## Alternatives considered

- **TI data sheets** — 1-based bus names that clash with bit numbers; typical values at 4.5 V,
  50 pF too, but the Nexperia sheets are the ones the project already cited.
- **`tpd` at 5 V / 15 pF, `ten`/`tdis` at 4.5 V** — closest to "typical at 5 V", but mixes
  conditions inside one chip.
- **One file per chip** — 18 near-identical files; the data-driven specs read like the data
  sheets' tables.
- **Function tables only in tests** — the Part tab would need a second copy.
- **Evaluating only the sections whose inputs changed** — faster, but wrong at power-on and after
  a recompile (some inputs show as changed in the same delta and the rest is skipped).
