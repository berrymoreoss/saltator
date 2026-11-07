/**
 * The behavior shared by every memory chip: cells as typed arrays, the read path with its `X`
 * window, and the hooks RAM writes plug into. Data sheets of memories give only limits, so the
 * outputs keep the old data for the minimum hold time, show `X` until the maximum access time
 * and then the data; a released output keeps driving until its maximum release time
 * (ADR-0017). Spec: docs/components.md#memories-mem.
 */
import {
  busValueText,
  Drive,
  type EvalContext,
  Level,
  type PinDef,
  type PinRef,
  pinIndex,
  type Time,
  toInput,
} from '../../core';
import { pinIndices } from '../74xx/chip';

/** The cells of one instance and what its read path needs to remember (plain typed arrays). */
export interface MemoryState {
  readonly data: Uint8Array;
  /** A set bit is unknown (`X`). */
  readonly unknown: Uint8Array;
  /** Event times in ps (`-Infinity`: never), indexed by `T_*`. */
  readonly times: Float64Array;
  /** Generation of the pending "data valid" wake-up; a new one makes older ones stale. */
  gen: number;
}

/** `times` slots: the last address change, CE̅ and OE̅ falling, WE̅ rising (RAM: a write ended). */
export const T_ADDRESS = 0;
export const T_CE = 1;
export const T_OE = 2;
export const T_WE = 3;
/** When the outputs' data becomes valid (the pending wake-up's time). */
export const T_VALID = 4;
export const TIME_SLOTS = 5;

/** The read path's limits, in ps, from the data sheet's AC read characteristics. */
export interface ReadTiming {
  /** Address to data valid, max (`tACC`, `tAA`). */
  readonly access: Time;
  /** Chip enable/select to data valid, max (`tCE`, `tACS`). */
  readonly ceAccess: Time;
  /** Output enable to data valid, max (`tOE`). */
  readonly oeAccess: Time;
  /** Output hold from an address change, min (`tOH`). */
  readonly hold: Time;
  /** Chip enable to output driving, min (`tCLZ`; 0 when not given). */
  readonly ceLowZ: Time;
  /** Output enable to output driving, min (`tOLZ`; 0 when not given). */
  readonly oeLowZ: Time;
  /** Chip enable released to output released, max (`tDF`, `tCHZ`). */
  readonly ceRelease: Time;
  /** Output enable released to output released, max (`tDF`, `tOHZ`). */
  readonly oeRelease: Time;
  /** RAM: write ended to output driving, min (`tOW`). */
  readonly weLowZ: Time;
  /** RAM: write started to output released, max (`tWHZ`). */
  readonly weRelease: Time;
}

/** The control and bus pins of a memory chip, as `PinRef`s. */
export interface MemoryPins {
  /** A0 first. */
  readonly address: Int32Array;
  /** I/O0 first. */
  readonly data: Int32Array;
  readonly ce: PinRef;
  readonly oe: PinRef;
  readonly we: PinRef;
}

/** The `PinRef`s of a memory chip with address pins A0… and data pins IO0… (or DQ0…). */
export function memoryPins(
  pinList: readonly PinDef[],
  addressBits: number,
  ce: string,
  data: 'IO' | 'DQ' = 'IO',
): MemoryPins {
  return {
    address: pinIndices(pinList, Array.from({ length: addressBits }, (_, i) => `A${i}`).join(', ')),
    data: pinIndices(pinList, Array.from({ length: 8 }, (_, i) => `${data}${i}`).join(', ')),
    ce: pinIndex(pinList, ce),
    oe: pinIndex(pinList, 'OE'),
    we: pinIndex(pinList, 'WE'),
  };
}

/** Data pins are named `IO0`…`IO7` (no `/` in pin names) and drawn as the data sheet: `I/O0`. */
export function withDataLabels(pinList: readonly PinDef[]): PinDef[] {
  return pinList.map((pin) =>
    /^IO\d$/.test(pin.name) ? { ...pin, label: `I/O${pin.name.slice(2)}` } : pin,
  );
}

export const MemoryDiagnosticKind = {
  /** An EEPROM saw a write; EEPROM writes are not simulated yet (R12a, Q5). */
  WRITE_IGNORED: 'write-ignored',
} as const;

/** Fresh state: `words` cells (filled by the caller), no events yet. */
export function createMemoryState(words: number): MemoryState {
  return {
    data: new Uint8Array(words),
    unknown: new Uint8Array(words),
    times: new Float64Array(TIME_SLOTS).fill(-Infinity),
    gen: 0,
  };
}

/** Merging more unknown address bits than this costs more than it tells: all `X`. */
const MAX_MERGED_BITS = 8;

/**
 * The read path: tracks the controls and the address, drives the data pins. `outputsOn` says
 * whether the outputs drive for the current controls (L1), don't (L0) or might (X).
 */
export class ReadPath {
  readonly #pins: MemoryPins;
  readonly #timing: ReadTiming;
  /** RAM: WE̅ gates the outputs, and the end of a write restarts the access. */
  readonly #writable: boolean;
  /** Address levels for messages (allocated once). */
  readonly #levels: Level[];

  constructor(pins: MemoryPins, timing: ReadTiming, writable: boolean) {
    this.#pins = pins;
    this.#timing = timing;
    this.#writable = writable;
    this.#levels = new Array<Level>(pins.address.length).fill(Level.X);
  }

  /** Records this delta's control edges and address change; true if the address changed. */
  track(ctx: EvalContext<MemoryState>, ce: Level, oe: Level, we: Level): boolean {
    const { now } = ctx;
    const times = ctx.state.times;
    const { address, ce: CE, oe: OE, we: WE } = this.#pins;
    if (ctx.changed(CE) && ce === Level.L0) times[T_CE] = now;
    if (ctx.changed(OE) && oe === Level.L0) times[T_OE] = now;
    if (this.#writable && ctx.changed(WE) && we === Level.L1) times[T_WE] = now;
    let changed = false;
    for (let i = 0; i < address.length; i++) if (ctx.changed(address[i]!)) changed = true;
    if (changed) times[T_ADDRESS] = now;
    return changed;
  }

  /**
   * Drives the outputs for the current state: released (after the release time of what turned
   * them off in this delta), `X` while they might drive, or the `X` window and then the data.
   * Re-driving what is already driven or pending schedules nothing (the inertial rule), so this
   * may run whenever anything changed, or nothing did.
   */
  update(
    ctx: EvalContext<MemoryState>,
    outputsOn: Level,
    addressChanged: boolean,
    release: Time,
  ): void {
    const state = ctx.state;
    const { times } = state;
    const timing = this.#timing;
    const { data } = this.#pins;
    const { now } = ctx;
    if (outputsOn !== Level.L1) {
      // A pending "data valid" wake-up no longer applies.
      if (times[T_VALID]! > now) {
        state.gen++;
        times[T_VALID] = -Infinity;
      }
      const drive = outputsOn === Level.L0 ? Drive.Z : Drive.STRONG_X;
      const delay = outputsOn === Level.L0 ? release : 0;
      for (let i = 0; i < data.length; i++) ctx.drive(data[i]!, drive, delay);
      return;
    }
    const valid = Math.max(
      times[T_ADDRESS]! + timing.access,
      times[T_CE]! + timing.ceAccess,
      times[T_OE]! + timing.oeAccess,
      times[T_WE]! + timing.access,
    );
    if (valid <= now) {
      this.driveData(ctx);
      return;
    }
    // The window: released until the outputs turn on, the old data for the hold time after an
    // address change, `X` until the data is valid.
    const lowZ = Math.max(
      times[T_CE]! + timing.ceLowZ,
      times[T_OE]! + timing.oeLowZ,
      times[T_WE]! + timing.weLowZ,
    );
    const delay = Math.max(lowZ - now, addressChanged ? timing.hold : 0, 0);
    for (let i = 0; i < data.length; i++) ctx.drive(data[i]!, Drive.STRONG_X, delay);
    if (valid !== times[T_VALID]) {
      times[T_VALID] = valid;
      state.gen++;
      ctx.wakeAfter(valid - now, state.gen);
    }
  }

  /** The "data valid" wake-up: drives the data unless something made it stale. */
  wake(ctx: EvalContext<MemoryState>, token: number): void {
    if (token !== ctx.state.gen || ctx.state.times[T_VALID] !== ctx.now) return;
    this.driveData(ctx);
  }

  /** Drives the cell the address selects; unknown bits merge every cell they could select. */
  driveData(ctx: EvalContext<MemoryState>): void {
    const { data: cells, unknown } = ctx.state;
    const { address, data } = this.#pins;
    let known = 0;
    let unknownBits = 0;
    let count = 0;
    for (let i = 0; i < address.length; i++) {
      const level = toInput(ctx.read(address[i]!));
      if (level === Level.L1) known |= 1 << i;
      else if (level === Level.X) {
        unknownBits |= 1 << i;
        count++;
      }
    }
    let ones = 0xff;
    let zeros = 0xff;
    if (count > MAX_MERGED_BITS) {
      ones = 0;
      zeros = 0;
    } else {
      // Every address the unknown bits allow: count through the subsets of `unknownBits`.
      let subset = 0;
      do {
        const a = known | subset;
        const value = cells[a]!;
        const x = unknown[a]!;
        ones &= value & ~x;
        zeros &= ~value & ~x;
        subset = (subset - unknownBits) & unknownBits;
      } while (subset !== 0);
    }
    for (let i = 0; i < data.length; i++) {
      const bit = 1 << i;
      const drive = ones & bit ? Drive.STRONG_1 : zeros & bit ? Drive.STRONG_0 : Drive.STRONG_X;
      ctx.drive(data[i]!, drive, 0);
    }
  }

  /** The address as text for messages: `0x01F`, `X` nibbles for unknown bits. */
  addressText(ctx: EvalContext<MemoryState>): string {
    const levels = this.#levels;
    const { address } = this.#pins;
    for (let i = 0; i < address.length; i++) levels[i] = toInput(ctx.read(address[i]!));
    return busValueText(levels);
  }
}

/**
 * Whether outputs enabled by active-LOW controls drive: L1 when every control is LOW, L0 when
 * one is HIGH, else X (they might).
 */
export function enabledByLow(a: Level, b: Level, c: Level = Level.L0): Level {
  if (a === Level.L1 || b === Level.L1 || c === Level.L1) return Level.L0;
  return a === Level.L0 && b === Level.L0 && c === Level.L0 ? Level.L1 : Level.X;
}
