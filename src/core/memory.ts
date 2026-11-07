/**
 * Memory parts' contents: ROM images in their document form (sparse hex runs), the view a
 * memory part gives of its cells for inspection, and the debug write that bypasses simulated
 * timing. Spec: docs/components.md#memories-mem.
 */

/** An erased EEPROM byte: every bit 1. Bytes an image doesn't list are erased. */
export const ERASED = 0xff;

/** The cells of a memory part, one byte per word. */
export interface MemoryView {
  readonly data: Uint8Array;
  /** A set bit is unknown (`X`): the bit stored in `data` means nothing. */
  readonly unknown: Uint8Array;
  /**
   * When each cell was last read, in ps (`-Infinity`: never): the outputs drove its data for
   * one known address. Inspectors light up the cells read since their last look.
   */
  readonly readAt: Float64Array;
  /**
   * When each cell was last written, in ps (`-Infinity`: never): a write of the circuit changed
   * it (or made it `X`), or a debug write did.
   */
  readonly writtenAt: Float64Array;
}

/** Fresh access stamps for `words` cells: never read, never written. */
export function createAccessStamps(words: number): Pick<MemoryView, 'readAt' | 'writtenAt'> {
  return {
    readAt: new Float64Array(words).fill(-Infinity),
    writtenAt: new Float64Array(words).fill(-Infinity),
  };
}

/**
 * What a memory part holds, for inspectors and test benches (`ComponentDefinition.memory`).
 * The view reads the instance's state; it never copies.
 */
export interface MemoryDef<State = unknown> {
  /** Number of words (addresses): `2 ** addressPins.length`. */
  readonly words: number;
  /** Bits per word, 1–8. */
  readonly width: number;
  /** RAM: contents live only while simulating. ROM: contents come from an `image` prop. */
  readonly volatile: boolean;
  /** The address pins, A0 first: the address the chip sees is read from them. */
  readonly addressPins: readonly string[];
  view(state: State): MemoryView;
}

/**
 * Debug write into a RAM at the current instant, bypassing its timing (an inspector edit, a
 * test bench loading a program): the cells change at once; outputs reading them follow through
 * the part's read path. `data` holds one byte per word from `address` on.
 */
export interface PokeAction {
  readonly type: 'poke';
  readonly address: number;
  readonly data: readonly number[];
}

export function isPokeAction(action: unknown): action is PokeAction {
  if (typeof action !== 'object' || action === null) return false;
  const { type, address, data } = action as Record<string, unknown>;
  return type === 'poke' && Number.isInteger(address) && Array.isArray(data);
}

/** The value of an `image` prop: whitespace-separated runs `AAAA:BBBB…` (address: bytes, hex). */
const RUN = /^([0-9A-Fa-f]{1,8}):((?:[0-9A-Fa-f]{2})+)$/;

/** What the `image` text form allows, for messages ("must be …"). */
export const IMAGE_HINT = 'hex runs "ADDR:BYTES" separated by spaces';

function shorten(text: string): string {
  return text.length > 24 ? `${text.slice(0, 21)}...` : text;
}

/**
 * Parses an image's text into `size` bytes (unlisted bytes erased); returns the problem instead
 * when the text is malformed: a run that isn't `ADDR:BYTES` in hex, runs that overlap or reach
 * past the end.
 */
export function readImage(text: string, size: number): Uint8Array | string {
  const bytes = new Uint8Array(size).fill(ERASED);
  const trimmed = text.trim();
  if (trimmed === '') return bytes;
  const written = new Uint8Array(size);
  for (const run of trimmed.split(/\s+/)) {
    const match = RUN.exec(run);
    if (!match) return `run "${shorten(run)}" is not ADDR:BYTES in hex`;
    const address = Number.parseInt(match[1]!, 16);
    const hex = match[2]!;
    const count = hex.length / 2;
    if (address + count > size) {
      return `run "${shorten(run)}" reaches past the last address 0x${(size - 1).toString(16).toUpperCase()}`;
    }
    for (let i = 0; i < count; i++) {
      if (written[address + i]) {
        return `run "${shorten(run)}" overlaps another at 0x${(address + i).toString(16).toUpperCase()}`;
      }
      written[address + i] = 1;
      bytes[address + i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    }
  }
  return bytes;
}

/** Parses an image's text into `size` bytes; throws on malformed text (see `readImage`). */
export function parseImage(text: string, size: number): Uint8Array {
  const result = readImage(text, size);
  if (typeof result === 'string') throw new Error(`invalid image: ${result}`);
  return result;
}

/**
 * Erased bytes this close together stay inside a run: writing them (2 characters each) is no
 * longer than starting a new run (` AAAA:`, 6 characters).
 */
const MERGE_GAP = 3;

/**
 * The canonical text of an image: runs of programmed bytes in address order, uppercase, the
 * address with at least 4 digits; erased stretches longer than 3 bytes left out. All erased:
 * `''`.
 */
export function formatImage(bytes: Uint8Array): string {
  const digits = Math.max(4, (Math.max(bytes.length, 1) - 1).toString(16).length);
  const runs: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] === ERASED) {
      i++;
      continue;
    }
    // A run starts here; extend it over short erased gaps, end it at the last programmed byte.
    const start = i;
    let end = i + 1;
    let j = end;
    while (j < bytes.length) {
      if (bytes[j] !== ERASED) {
        end = ++j;
      } else if (j - end < MERGE_GAP) {
        j++;
      } else {
        break;
      }
    }
    let hex = '';
    for (let k = start; k < end; k++) hex += bytes[k]!.toString(16).toUpperCase().padStart(2, '0');
    runs.push(`${start.toString(16).toUpperCase().padStart(digits, '0')}:${hex}`);
    i = end;
  }
  return runs.join(' ');
}

/** How many bytes differ from erased (`214` of a 2048-byte EEPROM). */
export function programmedBytes(bytes: Uint8Array): number {
  let count = 0;
  for (const b of bytes) if (b !== ERASED) count++;
  return count;
}
