/**
 * RAM writes as the SRAM data sheets draw them: a write is under way while chip select and write
 * enable are both LOW, and the cell at the address takes the data present when the first of
 * them rises. The data sheet's requirements are checked like ADR-0014's: a violation is
 * reported on the pin at fault and makes what the write may have hit `X`. An unknown control
 * that might write merges the data into the cells it could hit.
 * Spec: docs/components.md#memories-mem.
 */
import {
  type EvalContext,
  formatTime,
  Level,
  type PinDef,
  type PinRef,
  type Time,
  TimingViolation,
  toInput,
} from '../../core';
import { enabledByLow, type MemoryPins, type MemoryState, T_CE } from './memory';

/** The state of a RAM: its cells and read path, plus what its writes need to remember. */
export interface RamState extends MemoryState {
  /** Write times in ps (`-Infinity`: never), indexed by `W_*`, then each data bit's last change. */
  readonly writeTimes: Float64Array;
  /** `NOT_WRITING`, `WRITING` or `MAYBE_WRITING`. */
  writing: number;
  /** The address being (or last) written; set bits of `addressX` are unknown. */
  address: number;
  addressX: number;
  /** The address before its last change (observed, not read), for a violation at the start. */
  prevAddress: number;
  prevAddressX: number;
  /** A violation spoiled the write under way: the cell it ends in becomes `X`. */
  spoiled: boolean;
  /**
   * CS̅ and WE̅ have been known since power-on. Before, an unknown write is no write: every
   * output starts unknown for its first delay at power-on, a transient real chips ride out
   * while VCC ramps up.
   */
  controlsKnown: boolean;
}

export const NOT_WRITING = 0;
export const WRITING = 1;
export const MAYBE_WRITING = 2;

/** `writeTimes` slots: the write started, ended; the last address change; then data bits. */
const W_START = 0;
const W_END = 1;
const W_ADDRESS = 2;
const W_DATA = 3;

/** The data sheet's write requirements, in ps (guaranteed minima). */
export interface WriteTiming {
  /** Address set-up before the write starts (`tAS`). */
  readonly addressSetup: Time;
  /** Address valid to the end of the write (`tAW`). */
  readonly addressValid: Time;
  /** Write pulse width: the overlap of CS̅ and WE̅ LOW (`tWP`). */
  readonly pulse: Time;
  /** Chip select LOW to the end of the write (`tCW`). */
  readonly chipSelect: Time;
  /** Data valid to the end of the write (`tDW`). */
  readonly dataSetup: Time;
  /** Data hold after the end of the write (`tDH`). */
  readonly dataHold: Time;
  /** Address hold after the end of the write: write recovery (`tWR`). */
  readonly recovery: Time;
}

/** Fresh write state on top of a memory state. */
export function createRamState(base: MemoryState, dataBits: number): RamState {
  return {
    ...base,
    writeTimes: new Float64Array(W_DATA + dataBits).fill(-Infinity),
    writing: NOT_WRITING,
    address: 0,
    addressX: 0,
    prevAddress: 0,
    prevAddressX: 0,
    spoiled: false,
    controlsKnown: false,
  };
}

/** The addresses `address` could be with its `unknownBits` either way, through `cell`. */
export function forEachCandidate(
  address: number,
  unknownBits: number,
  cell: (address: number) => void,
): void {
  const known = address & ~unknownBits;
  let subset = 0;
  do {
    cell(known | subset);
    subset = (subset - unknownBits) & unknownBits;
  } while (subset !== 0);
}

/** `5 ns before`, `at the same time as`. */
function when(elapsed: Time, relation: 'before' | 'after'): string {
  return elapsed === 0 ? 'at the same time as' : `${formatTime(elapsed)} ${relation}`;
}

export class WritePath {
  readonly #pins: MemoryPins;
  readonly #pinList: readonly PinDef[];
  readonly #timing: WriteTiming;

  constructor(pins: MemoryPins, pinList: readonly PinDef[], timing: WriteTiming) {
    this.#pins = pins;
    this.#pinList = pinList;
    this.#timing = timing;
  }

  /**
   * Runs the write state machine for this delta. Changes at the same instant as a write's
   * start count as before it, at the same instant as its end as after it. Runs before the read
   * path records the delta's times (it uses the chip select's previous fall).
   */
  evaluate(ctx: EvalContext<RamState>, cs: Level, we: Level): void {
    const state = ctx.state;
    const times = state.writeTimes;
    const { now } = ctx;
    const timing = this.#timing;
    const { address: addressPins, data } = this.#pins;
    const write = enabledByLow(cs, we);
    if (write !== Level.X) state.controlsKnown = true;
    const next =
      write === Level.L1
        ? WRITING
        : write === Level.L0 || !state.controlsKnown
          ? NOT_WRITING
          : MAYBE_WRITING;
    let changedPin = -1;
    for (let i = 0; i < addressPins.length; i++) {
      if (changedPin < 0 && ctx.changed(addressPins[i]!)) changedPin = addressPins[i]!;
    }
    const addressChanged = changedPin >= 0;

    // 1. The address changing during a write: forbidden (it may write the old and new cell).
    if (addressChanged && state.writing !== NOT_WRITING && next !== NOT_WRITING) {
      if (state.writing === WRITING) {
        this.#violation(ctx, TimingViolation.SETUP, changedPin, 'during the write');
        this.#markX(state, state.address, state.addressX);
        state.spoiled = true;
      } else {
        this.#merge(ctx, state.address, state.addressX);
      }
      this.#readAddress(ctx);
    }

    // 2. A write ends: its checks, then the cell takes the data.
    if (state.writing === WRITING && next !== WRITING) {
      this.#end(ctx, cs === Level.L0 ? this.#pins.we : this.#pins.ce);
      state.writing = next === MAYBE_WRITING ? MAYBE_WRITING : NOT_WRITING;
    } else if (state.writing === MAYBE_WRITING && next === NOT_WRITING) {
      this.#merge(ctx, state.address, state.addressX);
      times[W_END] = now;
      state.writing = NOT_WRITING;
    }

    // 3. The address before this delta's change, for a violation at a start.
    if (addressChanged) {
      let prev = 0;
      let prevX = 0;
      for (let i = 0; i < addressPins.length; i++) {
        const level = toInput(ctx.prev(addressPins[i]!));
        if (level === Level.L1) prev |= 1 << i;
        else if (level !== Level.L0) prevX |= 1 << i;
      }
      state.prevAddress = prev;
      state.prevAddressX = prevX;
    }

    // 4. A write starts: the address must have been set up tAS before.
    if (state.writing === NOT_WRITING && next !== NOT_WRITING) {
      this.#readAddress(ctx);
      times[W_START] = now;
      state.spoiled = false;
      const elapsed = addressChanged ? 0 : now - times[W_ADDRESS]!;
      if (next === WRITING && elapsed < timing.addressSetup) {
        this.#violation(
          ctx,
          TimingViolation.SETUP,
          addressChanged ? changedPin : this.#lastAddressPin(state),
          `${when(elapsed, 'before')} the write started (tAS ≥ ${formatTime(timing.addressSetup)})`,
        );
        this.#markX(state, state.prevAddress, state.prevAddressX);
        state.spoiled = true;
      }
    } else if (state.writing === MAYBE_WRITING && next === WRITING) {
      times[W_START] = now;
    }

    // 5. Just after a write: the address must stay tWR, the data tDH.
    if (state.writing === NOT_WRITING && next === NOT_WRITING) {
      const elapsed = now - times[W_END]!;
      if (addressChanged && elapsed < timing.recovery) {
        this.#violation(
          ctx,
          TimingViolation.HOLD,
          changedPin,
          `${when(elapsed, 'after')} the write ended (tWR ≥ ${formatTime(timing.recovery)})`,
        );
        this.#markX(state, state.address, state.addressX);
        const written = state.address;
        const writtenX = state.addressX;
        this.#readAddress(ctx);
        this.#markX(state, state.address, state.addressX);
        state.address = written;
        state.addressX = writtenX;
      }
      if (elapsed < timing.dataHold) this.#dataHold(ctx, elapsed);
    }

    // 6. This delta's changes, recorded after the checks that count them as after an end.
    if (addressChanged) times[W_ADDRESS] = now;
    for (let i = 0; i < data.length; i++) if (ctx.changed(data[i]!)) times[W_DATA + i] = now;
    state.writing = next;
  }

  /** The end of a write: data set-up, pulse widths, address valid; then the cell is written. */
  #end(ctx: EvalContext<RamState>, endPin: PinRef): void {
    const state = ctx.state;
    const times = state.writeTimes;
    const { now } = ctx;
    const timing = this.#timing;
    const { data } = this.#pins;
    times[W_END] = now;

    let value = 0;
    let unknownBits = 0;
    for (let i = 0; i < data.length; i++) {
      const pin = data[i]!;
      // A bit changing at this instant counts as after the end: store its level before.
      const level = toInput(ctx.changed(pin) ? ctx.prev(pin) : ctx.read(pin));
      if (level === Level.L1) value |= 1 << i;
      else if (level !== Level.L0) unknownBits |= 1 << i;
      const elapsed = now - times[W_DATA + i]!;
      if (elapsed < timing.dataSetup) {
        unknownBits |= 1 << i;
        this.#violation(
          ctx,
          TimingViolation.SETUP,
          pin,
          `${when(elapsed, 'before')} the write ended (tDW ≥ ${formatTime(timing.dataSetup)})`,
        );
      }
    }

    const overlap = now - times[W_START]!;
    if (overlap < timing.pulse) {
      ctx.report({
        kind: TimingViolation.PULSE_WIDTH,
        message: `the write lasted only ${formatTime(overlap)} (tWP ≥ ${formatTime(timing.pulse)})`,
        pin: endPin,
      });
      unknownBits = 0xff;
    }
    const selected = now - state.times[T_CE]!;
    if (selected < timing.chipSelect) {
      ctx.report({
        kind: TimingViolation.PULSE_WIDTH,
        message: `${this.#pinList[this.#pins.ce]!.name} was LOW for only ${formatTime(selected)} when the write ended (tCW ≥ ${formatTime(timing.chipSelect)})`,
        pin: this.#pins.ce,
      });
      unknownBits = 0xff;
    }
    const valid = now - times[W_ADDRESS]!;
    if (valid < timing.addressValid) {
      this.#violation(
        ctx,
        TimingViolation.SETUP,
        this.#lastAddressPin(state),
        `${when(valid, 'before')} the write ended (tAW ≥ ${formatTime(timing.addressValid)})`,
      );
      this.#markX(state, state.prevAddress, state.prevAddressX);
      state.spoiled = true;
    }

    this.#store(state, value, unknownBits);
    if (state.spoiled) this.#markX(state, state.address, state.addressX);
  }

  /** A data bit changing within tDH after the end: that bit is unknown where it differs. */
  #dataHold(ctx: EvalContext<RamState>, elapsed: Time): void {
    const state = ctx.state;
    const { data } = this.#pins;
    for (let i = 0; i < data.length; i++) {
      const pin = data[i]!;
      if (!ctx.changed(pin)) continue;
      this.#violation(
        ctx,
        TimingViolation.HOLD,
        pin,
        `${when(elapsed, 'after')} the write ended (tDH ≥ ${formatTime(this.#timing.dataHold)})`,
      );
      const level = toInput(ctx.read(pin));
      const bit = 1 << i;
      forEachCandidate(state.address, state.addressX, (a) => {
        const stored = state.data[a]! & bit ? Level.L1 : Level.L0;
        if (level !== stored || state.unknown[a]! & bit) state.unknown[a] = state.unknown[a]! | bit;
      });
    }
  }

  /** The cell at the write address takes `value`; with unknown address bits each may have. */
  #store(state: RamState, value: number, unknownBits: number): void {
    if (state.addressX === 0) {
      state.data[state.address] = value;
      state.unknown[state.address] = unknownBits;
      return;
    }
    forEachCandidate(state.address, state.addressX, (a) => {
      state.unknown[a] = state.unknown[a]! | unknownBits | (state.data[a]! ^ value);
    });
  }

  /** A write that may have happened: each cell it could hit is unknown where the data differs. */
  #merge(ctx: EvalContext<RamState>, address: number, addressX: number): void {
    const state = ctx.state;
    const { data } = this.#pins;
    let value = 0;
    let unknownBits = 0;
    for (let i = 0; i < data.length; i++) {
      const level = toInput(ctx.read(data[i]!));
      if (level === Level.L1) value |= 1 << i;
      else if (level !== Level.L0) unknownBits |= 1 << i;
    }
    forEachCandidate(address, addressX, (a) => {
      state.unknown[a] = state.unknown[a]! | unknownBits | (state.data[a]! ^ value);
    });
  }

  #markX(state: RamState, address: number, addressX: number): void {
    forEachCandidate(address, addressX, (a) => {
      state.unknown[a] = 0xff;
    });
  }

  /** Reads the address pins into `state.address`/`addressX`. */
  #readAddress(ctx: EvalContext<RamState>): void {
    const pins = this.#pins.address;
    let address = 0;
    let addressX = 0;
    for (let i = 0; i < pins.length; i++) {
      const level = toInput(ctx.read(pins[i]!));
      if (level === Level.L1) address |= 1 << i;
      else if (level !== Level.L0) addressX |= 1 << i;
    }
    ctx.state.address = address;
    ctx.state.addressX = addressX;
  }

  /** An address pin that changed last: one where the address differs from the one before. */
  #lastAddressPin(state: RamState): PinRef {
    const pins = this.#pins.address;
    const diff = (state.address ^ state.prevAddress) | state.addressX | state.prevAddressX;
    for (let i = 0; i < pins.length; i++) if (diff & (1 << i)) return pins[i]!;
    return pins[0]!;
  }

  #violation(ctx: EvalContext<RamState>, kind: string, pin: PinRef, what: string): void {
    const def = this.#pinList[pin]!;
    ctx.report({ kind, message: `${def.label ?? def.name} changed ${what}`, pin });
  }
}
