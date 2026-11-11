/**
 * A module's timing checks from its `specify` block (HDL-2, ADR-0014): declared once per module
 * with core's `TimingChecks` on the part's pins, plus what the module part needs to make `X` what
 * a violation may have loaded — the flip-flop groups a check's clock drives, the read pins of its
 * data (for "what if this pin were `X`"), and snapshot slots: the `Q` words of the flip-flops a pin
 * drives, saved when it makes the edge that starts a pulse (pulse widths) or loads (removal). The
 * runtime is in `module-part.ts`. Spec: docs/components.md#verilog-modules-hdl.
 */
import {
  type Edge,
  type HdlBit,
  type HdlCheck,
  type HdlCheckKind,
  type PinDef,
  type PulseWidthCheck,
  type RecoveryCheck,
  type SetupHoldCheck,
  TimingChecks,
} from '../../core';
import type { Layout } from './layout';

/** One check as the part runs it. */
export interface CompiledCheck {
  readonly kind: HdlCheckKind;
  /** The clock's part pin and whether its rising edge counts (setup, hold, recovery, removal). */
  readonly clockPin: number;
  readonly rising: boolean;
  /** Per data pin (in the check's order), its read index; −1 where the pin isn't read. */
  readonly dataReads: Int32Array;
  /** The conditions arming it (clock's, data's): words and positions; word −1 = always. */
  readonly whenWord: Int32Array;
  readonly whenPos: Int32Array;
  readonly setupHold?: SetupHoldCheck;
  readonly width?: PulseWidthCheck;
  readonly recovery?: RecoveryCheck;
  /** The flip-flop groups clocked by the check's clock pin on its edge. */
  readonly groups: Int32Array;
  /** Its snapshot slot (a width: the pulse's start; removal: the clock's edge); −1 none. */
  readonly slot: number;
}

/** The checks of a module and its snapshot slots. */
export interface ModuleChecks {
  readonly checks: TimingChecks;
  readonly list: readonly CompiledCheck[];
  /** Per slot: its pin and edge (1 rising), and its words (`slotStart` into `slotWords`). */
  readonly slotPin: Int32Array;
  readonly slotRising: Uint8Array;
  readonly slotStart: Int32Array;
  readonly slotWords: Int32Array;
}

/** What `compileChecks` needs of the compiled module. */
export interface CheckContext {
  readonly pins: readonly PinDef[];
  readonly layout: Layout;
  /** The part pins an input's or inout's bit enters by. */
  readonly entering: (bit: number) => readonly number[];
  /** Per part pin, its read index; −1 for pins not read into the words. */
  readonly readOf: Int32Array;
  /** The flip-flop groups: their clock pin (−1: logic), edge and members. */
  readonly groups: readonly {
    readonly pin: number;
    readonly rising: boolean;
    readonly members: Int32Array;
  }[];
  /** Per flip-flop, its `Q` words. */
  readonly qFirst: Int32Array;
  readonly qCount: Int32Array;
  /** Per flip-flop, the read indices its asynchronous controls come from. */
  readonly asyncCones: readonly Int32Array[];
}

/** Compiles `list`; undefined when it is empty. */
export function compileChecks(
  list: readonly HdlCheck[],
  context: CheckContext,
): ModuleChecks | undefined {
  if (list.length === 0) return undefined;
  const { pins, layout, entering, readOf, groups, qFirst, qCount, asyncCones } = context;
  const min: Record<string, number> = {};
  list.forEach((check, i) => {
    min[`limit${i}`] = check.limit;
  });
  const checks = new TimingChecks(pins, min);
  const pinOf = (bit: number) => entering(bit)[0]!;
  const nameOf = (bit: number) => pins[pinOf(bit)]!.name;
  const whenPlace = (when: HdlBit | undefined): [number, number] =>
    typeof when === 'number' ? [layout.word[when]!, layout.pos[when]!] : [-1, 0];

  // Snapshot slots by pin and edge; each saves the Q words of the flip-flops the pin drives.
  const slotKeys = new Map<string, number>();
  const slotPin: number[] = [];
  const slotRising: number[] = [];
  const slotStart: number[] = [0];
  const slotWords: number[] = [];
  const slotOf = (pin: number, edge: Edge): number => {
    const key = `${pin}:${edge}`;
    const known = slotKeys.get(key);
    if (known !== undefined) return known;
    const read = readOf[pin]!;
    const flops = new Set<number>();
    for (const group of groups) {
      if (group.pin === pin) for (const k of group.members) flops.add(k);
    }
    asyncCones.forEach((cone, k) => {
      if (read >= 0 && cone.includes(read)) flops.add(k);
    });
    for (const k of [...flops].sort((a, b) => a - b)) {
      for (let w = qFirst[k]!; w < qFirst[k]! + qCount[k]!; w++) slotWords.push(w);
    }
    const slot = slotPin.length;
    slotKeys.set(key, slot);
    slotPin.push(pin);
    slotRising.push(edge === 'rise' ? 1 : 0);
    slotStart.push(slotWords.length);
    return slot;
  };

  const compiled = list.map((check, i): CompiledCheck => {
    const key = `limit${i}`;
    const clockBit = check.clock.bits[0]!;
    const clockPin = pinOf(clockBit);
    const clock = nameOf(clockBit);
    const edge = check.clock.edge!;
    const rising = edge === 'rise';
    const dataPins = check.data.bits.map(pinOf);
    const data = check.data.bits.map(nameOf).join(', ');
    const [cw, cp] = whenPlace(check.clock.when);
    const [dw, dp] = whenPlace(check.data.when);
    const base = {
      kind: check.kind,
      clockPin,
      rising,
      dataReads: Int32Array.from(dataPins, (pin) => readOf[pin]!),
      whenWord: Int32Array.of(cw, dw),
      whenPos: Int32Array.of(cp, dp),
      groups: Int32Array.from(
        groups.flatMap((g, index) => (g.pin === clockPin && g.rising === rising ? [index] : [])),
      ),
    };
    switch (check.kind) {
      case 'setup':
        return {
          ...base,
          setupHold: checks.setupHold({ data, clock, edge, setup: key }),
          slot: -1,
        };
      case 'hold':
        return { ...base, setupHold: checks.setupHold({ data, clock, edge, hold: key }), slot: -1 };
      case 'removal':
        // The control's release (its edge) held after the clock's edge: a hold of the release.
        return {
          ...base,
          setupHold: checks.setupHold({ data, clock, edge, hold: key, dataEdge: check.data.edge! }),
          slot: slotOf(clockPin, edge),
        };
      case 'recovery':
        return {
          ...base,
          recovery: checks.recovery({
            pin: data,
            // Released by its rising edge: active LOW.
            active: check.data.edge === 'rise' ? 'low' : 'high',
            clock,
            edge,
            recovery: key,
          }),
          slot: -1,
        };
      default:
        // 'width': a pulse from the clock event's edge to the opposite one, HIGH when it rises.
        return {
          ...base,
          width: checks.pulseWidth({ pin: clock, level: rising ? 'high' : 'low', width: key }),
          slot: slotOf(clockPin, edge),
        };
    }
  });
  return {
    checks,
    list: compiled,
    slotPin: Int32Array.from(slotPin),
    slotRising: Uint8Array.from(slotRising),
    slotStart: Int32Array.from(slotStart),
    slotWords: Int32Array.from(slotWords),
  };
}
