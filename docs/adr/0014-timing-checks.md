# 0014. Timing checks: guaranteed minima, and a violation makes the loaded bits unknown

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R09a (`feat/74hc-registers`)

## Context

R09a brings the first edge-triggered chips (74HC74, 107, 109, 112, 173, 175, 273, 374, 377, 574).
A flip-flop only works if its inputs respect the data sheet's set-up, hold, pulse-width and
recovery times; a design that violates them may work on the bench with one chip at room
temperature and fail with another — exactly what "test before fab" is meant to catch. The
simulation runs on typical delays at 25 °C (ADR-0011). Three choices outlive the branch:

- **Which limit** a check compares against. Data sheets give a typical value (what an average
  chip needs, often near zero or negative: 74HC74 `th` typ −2 ns) and a guaranteed minimum (at
  25 °C and/or over −40 °C to +85 °C).
- **What happens** after a violation: report only, or also model the uncertain result.
- **Where** the checks live: memories (R12) and the CPU (R17) have the same kind of requirements
  (address set-up, write pulse width).

## Decision

- **Limit:** the data sheet's guaranteed minimum at 25 °C, recorded in `TimingDef.min`; the
  typical value goes into `timing.typical` for reference. Where a data sheet gives no 25 °C
  column (74HC74 rev. 9) its −40 °C to +85 °C minimum is used and the conditions say so.
- **Effect:** a violation is reported (`setup-violation`, `hold-violation`,
  `pulse-width-violation`, `recovery-violation`, errors in the Simulation tab) **and** the bits
  the edge may have loaded become `X` until a set/reset or a clean load — where the possible
  outcomes differ, as precise as cheap (docs/components.md#timing-checks). This is the rule the
  kernel already prescribes for an uncertain clock edge.
- **Armed:** a clock's requirements apply only while the part acts on it (not held in
  set/reset; the data's only while loading is enabled).
- **Place:** `TimingChecks` in `core`, generic over pins and keys; parts declare their checks
  and keep the change times in their state. Checks observe pins (`changed`, `prev`), they never
  read them, so they don't report floating inputs nobody uses.

## Consequences

- A marginal design shows red wires and an error where it is marginal, not a silently correct
  simulation; the learner sees which pin and by how much (`… 9 ns before 1CP rose (setup time ≥
  15 ns)`).
- An `X` from a violation spreads like any `X` and stays until a reset or reload: noisy, but it
  cannot hide. A "report only" setting can be added later if it gets in the way.
- Typical delays with guaranteed minima mix conditions on purpose: delays say what happens,
  minima what is guaranteed. A worst-case mode would pair the recorded `max` delays with the
  −40 °C to +85 °C minima (not recorded yet).
- The checks cost ≈ 18 % on a register pipeline benchmark (6.7M → 5.5M events/s).
- The carry-over invariance holds with the checks (forced evaluations neither fire nor record);
  the property test now compares timing violations too.

## Alternatives considered

- **Typical requirements** — consistent with typical delays, but typical set-up and hold are near
  zero or negative, so the checks would hardly ever fire: they would pass designs the data sheet
  doesn't guarantee.
- **Minima over −40 °C to +85 °C** — the strictest; it belongs with the maximum delays in a
  worst-case mode, not with typical delays at room temperature.
- **Report only** — quieter, but the simulation would go on as if the flip-flop had loaded
  correctly, hiding the consequence the report warns about.
- **Checks inside each chip** — the same logic again for every family of parts, and again for
  memories and CPUs.
