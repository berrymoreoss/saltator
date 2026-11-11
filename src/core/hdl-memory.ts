/**
 * Memories of Verilog modules (HDL-6): the power-up contents a module's IR keeps as text — what
 * Yosys read from `initial` blocks and `$readmemh` — and the words they stand for. Spec:
 * docs/components.md#verilog-modules-hdl.
 */
import type { HdlMemory } from './hdl-module';

/**
 * A memory's words, 4-state: each word is `limbs` 32-bit limbs, least significant first, word
 * `i` at `i * limbs`. A set bit of `unk` is unknown (its `val` bit is 0); bits above the width
 * are 0 in both.
 */
export interface HdlMemoryWords {
  readonly limbs: number;
  readonly val: Uint32Array;
  readonly unk: Uint32Array;
}

/** The 32-bit limbs a word of `width` bits takes. */
export function hdlMemoryLimbs(width: number): number {
  return Math.ceil(width / 32);
}

/** The bits limb `l` of a word of `width` bits uses. */
function limbMask(width: number, l: number): number {
  const bits = Math.min(32, width - 32 * l);
  return bits >= 32 ? 0xffffffff : (2 ** bits - 1) >>> 0;
}

/** A memory's words, every bit unknown: its power-up contents without an `init`. */
export function unknownHdlMemoryWords(memory: Pick<HdlMemory, 'width' | 'size'>): HdlMemoryWords {
  const limbs = hdlMemoryLimbs(memory.width);
  const unk = new Uint32Array(memory.size * limbs);
  for (let l = 0; l < limbs; l++) {
    const mask = limbMask(memory.width, l);
    for (let i = l; i < unk.length; i += limbs) unk[i] = mask;
  }
  return { limbs, val: new Uint32Array(unk.length), unk };
}

/** A run of `init`: the Verilog address of its first word, then its words' hex digits. */
const RUN = /^([0-9A-Fa-f]{1,8}):([0-9A-Fa-fxX]+)$/;

/** What `init` allows, for messages. */
export const HDL_INIT_HINT =
  'runs "ADDR:WORDS" separated by spaces (hex; each word as many digits as its width needs, x unknown)';

/**
 * Reads a memory's power-up contents: its `init` runs over all-unknown words, or the problem
 * with the text — a run that isn't `ADDR:WORDS`, a word with bits above the width, runs outside
 * the memory or overlapping.
 */
export function readHdlMemoryInit(
  memory: Pick<HdlMemory, 'width' | 'size' | 'offset' | 'init'>,
): HdlMemoryWords | string {
  const words = unknownHdlMemoryWords(memory);
  const text = memory.init?.trim() ?? '';
  if (text === '') return words;
  const { width, size, offset } = memory;
  const { limbs, val, unk } = words;
  const digits = Math.ceil(width / 4);
  const topBits = width - 4 * (digits - 1);
  const given = new Uint8Array(size);
  for (const run of text.split(/\s+/)) {
    const match = RUN.exec(run);
    if (!match) return `run "${shorten(run)}" is not ADDR:WORDS`;
    const hex = match[2]!;
    if (hex.length % digits !== 0) {
      return `run "${shorten(run)}": its words take ${digits} digit${digits === 1 ? '' : 's'} each`;
    }
    const first = Number.parseInt(match[1]!, 16) - offset;
    const count = hex.length / digits;
    if (first < 0 || first + count > size) {
      return `run "${shorten(run)}" is outside the memory's addresses ${hexOf(offset)}–${hexOf(offset + size - 1)}`;
    }
    for (let w = 0; w < count; w++) {
      const index = first + w;
      if (given[index]) return `run "${shorten(run)}" overlaps another at ${hexOf(offset + index)}`;
      given[index] = 1;
      for (let l = 0; l < limbs; l++) {
        val[index * limbs + l] = 0;
        unk[index * limbs + l] = 0;
      }
      // Digit d (most significant first) holds bits 4·(digits − 1 − d) and up.
      for (let d = 0; d < digits; d++) {
        const c = hex[w * digits + d]!;
        const shift = 4 * (digits - 1 - d);
        const l = Math.floor(shift / 32);
        const at = index * limbs + l;
        const bits = d === 0 ? topBits : 4;
        const nibbleMask = 2 ** bits - 1;
        if (c === 'x' || c === 'X') {
          unk[at] = (unk[at]! | (nibbleMask << (shift % 32))) >>> 0;
          continue;
        }
        const nibble = Number.parseInt(c, 16);
        if (nibble > nibbleMask) {
          return `run "${shorten(run)}": word ${hexOf(offset + index)} is wider than ${width} bits`;
        }
        val[at] = (val[at]! | (nibble << (shift % 32))) >>> 0;
      }
    }
  }
  return words;
}

/**
 * The `init` text of a memory's words: runs of consecutive words with a known bit, in address
 * order, uppercase hex, the address with at least 4 digits; a digit with an unknown bit is `x`
 * (a nibble partly unknown counts as unknown). All unknown: `''`.
 */
export function formatHdlMemoryInit(
  memory: Pick<HdlMemory, 'width' | 'size' | 'offset'>,
  words: HdlMemoryWords,
): string {
  const { width, size, offset } = memory;
  const { limbs, val, unk } = words;
  const digits = Math.ceil(width / 4);
  const addressDigits = Math.max(4, (offset + Math.max(size, 1) - 1).toString(16).length);
  const known = (index: number) => {
    for (let l = 0; l < limbs; l++) {
      const mask = limbMask(width, l);
      if ((unk[index * limbs + l]! & mask) >>> 0 !== mask) return true;
    }
    return false;
  };
  const word = (index: number) => {
    let text = '';
    for (let d = 0; d < digits; d++) {
      const shift = 4 * (digits - 1 - d);
      const at = index * limbs + Math.floor(shift / 32);
      const s = shift % 32;
      text +=
        ((unk[at]! >>> s) & 0xf) !== 0 ? 'x' : ((val[at]! >>> s) & 0xf).toString(16).toUpperCase();
    }
    return text;
  };
  const runs: string[] = [];
  for (let i = 0; i < size; ) {
    if (!known(i)) {
      i++;
      continue;
    }
    let text = `${(offset + i).toString(16).toUpperCase().padStart(addressDigits, '0')}:`;
    for (; i < size && known(i); i++) text += word(i);
    runs.push(text);
  }
  return runs.join(' ');
}

function hexOf(n: number): string {
  return `0x${n.toString(16).toUpperCase()}`;
}

function shorten(text: string): string {
  return text.length > 24 ? `${text.slice(0, 21)}...` : text;
}
