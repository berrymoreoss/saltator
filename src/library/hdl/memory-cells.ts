/**
 * A module's memories (HDL-6): their words in an instance's state, the read ports as steps over
 * the planes, and the write ports, edge-triggered in two phases like flip-flops — what an edge
 * writes is sampled from the values before it, then stored with the flip-flops' loads. `X` as the
 * memory chips have it: an unknown address reads the words it could select merged (up to 8 such
 * bits; beyond them, or reaching outside the memory, all `X`); a write that may happen, or may hit
 * several words, makes `X` the bits it would change; two ports writing one bit at one edge make it
 * `X` where they differ unless one wins (`PRIORITY`). Spec: docs/components.md#verilog-modules-hdl.
 */
import { type HdlCell, type HdlMemory, type HdlMemoryWords, readHdlMemoryInit } from '../../core';
import { type CellStep, indices, type MemoryPlanes, merge, TX, tri } from './planes';

/** The most unknown address bits a read merges the words of; beyond, it reads all `X`. */
export const MAX_MERGED_BITS = 8;

/** A memory as instances run it. */
export interface CompiledMemory {
  readonly name: string;
  readonly width: number;
  readonly size: number;
  /** The Verilog address of word 0. */
  readonly base: number;
  readonly limbs: number;
  /** Its power-up words. */
  readonly init: HdlMemoryWords;
}

/** A memory of a module whose shape was checked (`hdlModuleProblems`). */
export function compileMemory(memory: HdlMemory): CompiledMemory {
  const init = readHdlMemoryInit(memory);
  if (typeof init === 'string') throw new Error(`memory ${memory.name}: ${init}`);
  const { name, width, size, offset } = memory;
  return { name, width, size, base: offset, limbs: init.limbs, init };
}

/** An instance's memories: words, access stamps, and what its read ports read. */
export interface MemoryState extends MemoryPlanes {
  /** Per memory, when each word was last read and written, in ps (ADR-0018's stamps). */
  readonly readAt: readonly Float64Array[];
  readonly writtenAt: readonly Float64Array[];
  /** Per read port, the word it was last stamped for (−1: none). */
  readonly stampedWord: Int32Array;
}

/** Power-up memories for an instance: each memory's `init`, nothing read or written yet. */
export function newMemoryState(memories: readonly CompiledMemory[], reads: number): MemoryState {
  return {
    mval: memories.map((m) => m.init.val.slice()),
    munk: memories.map((m) => m.init.unk.slice()),
    readWord: new Int32Array(reads).fill(-1),
    readAt: memories.map((m) => new Float64Array(m.size).fill(-Infinity)),
    writtenAt: memories.map((m) => new Float64Array(m.size).fill(-Infinity)),
    stampedWord: new Int32Array(reads).fill(-1),
  };
}

/** The number of set bits of a 32-bit value. */
function popCount(x: number): number {
  let n = 0;
  for (let v = x >>> 0; v !== 0; v = (v & (v - 1)) >>> 0) n++;
  return n;
}

/** `readAddress`'s result: the known bits, the unknown ones (32-bit each), and bits 32 and up. */
const address = new Float64Array(3);
/** Bits 32 and up: all 0, one surely 1 (outside every memory), or unknown ones. */
const HIGH_ZERO = 0;
const HIGH_ONE = 1;
const HIGH_UNKNOWN = 2;

/** Reads an address from the planes into `address`. */
function readAddress(val: Uint8Array, unk: Uint8Array, bits: Int32Array): void {
  let a = 0;
  let x = 0;
  let high = HIGH_ZERO;
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i]!;
    if (i < 32) {
      if (unk[b]) x |= 1 << i;
      else if (val[b]) a |= 1 << i;
    } else if (unk[b]) {
      if (high === HIGH_ZERO) high = HIGH_UNKNOWN;
    } else if (val[b]) high = HIGH_ONE;
  }
  address[0] = a >>> 0;
  address[1] = x >>> 0;
  address[2] = high;
}

/** The next subset of the bits of `mask` after `subset` (0 after the last). */
const nextSubset = (subset: number, mask: number) => ((subset - mask) & mask) >>> 0;

/**
 * A read port (`$memrd`, the `port`-th of the module): the word at its address, `X` outside the
 * memory, merged over the words an unknown address could select. It notes the word it read (for
 * the access stamps, set after the evaluation), and nothing else.
 */
export function compileReadStep(
  cell: HdlCell,
  memoryIndex: number,
  memory: CompiledMemory,
  port: number,
  bitCount: number,
): CellStep {
  const addr = indices(cell, 'ADDR', bitCount);
  const data = indices(cell, 'DATA', bitCount);
  const { width, size, base, limbs } = memory;
  const allX = (val: Uint8Array, unk: Uint8Array) => {
    for (let i = 0; i < width; i++) {
      val[data[i]!] = 0;
      unk[data[i]!] = 1;
    }
  };
  return (val, unk, mem) => {
    const planes = mem!;
    const words = planes.mval[memoryIndex]!;
    const unknown = planes.munk[memoryIndex]!;
    planes.readWord[port] = -1;
    readAddress(val, unk, addr);
    const a = address[0]!;
    const x = address[1]!;
    if (address[2] !== HIGH_ZERO || popCount(x) > MAX_MERGED_BITS) {
      allX(val, unk);
      return;
    }
    const known = (a & ~x) >>> 0;
    let subset = 0;
    let first = true;
    do {
      const w = ((known | subset) >>> 0) - base;
      if (w < 0 || w >= size) {
        allX(val, unk);
        return;
      }
      const at = w * limbs;
      for (let i = 0; i < width; i++) {
        const limb = at + (i >>> 5);
        const s = i & 31;
        const u = (unknown[limb]! >>> s) & 1;
        const v = (words[limb]! >>> s) & 1;
        const b = data[i]!;
        if (first) {
          unk[b] = u;
          val[b] = v & (u ^ 1);
        } else if (!unk[b] && (u || v !== val[b])) {
          unk[b] = 1;
          val[b] = 0;
        }
      }
      if (x === 0) planes.readWord[port] = w;
      first = false;
      subset = nextSubset(subset, x);
    } while (subset !== 0);
  };
}

/** A memory's write port (`$memwr`) as instances run it. */
export interface WritePort {
  readonly memory: number;
  /** The plane index of its clock. */
  readonly clk: number;
  readonly rising: boolean;
  readonly en: Int32Array;
  readonly data: Int32Array;
  readonly addr: Int32Array;
  /** Its first bit in the samples' per-bit arrays. */
  readonly offset: number;
  /**
   * The memory's earlier write ports (indices among the module's write ports) and, for each,
   * whether this one wins where both write a bit at one edge.
   */
  readonly earlier: Int32Array;
  readonly wins: Uint8Array;
}

/**
 * Compiles the write ports of a module, in cell order: `cells[i]` writes into
 * `memories[cells[i].params.MEMORY]`.
 */
export function compileWritePorts(cells: readonly HdlCell[], bitCount: number): WritePort[] {
  const byMemory = new Map<number, number[]>();
  let offset = 0;
  return cells.map((cell, p) => {
    const memory = cell.params.MEMORY as number;
    const earlier = byMemory.get(memory) ?? [];
    byMemory.set(memory, [...earlier, p]);
    const priority = cell.params.PRIORITY as readonly string[];
    const en = indices(cell, 'EN', bitCount);
    const port: WritePort = {
      memory,
      clk: indices(cell, 'CLK', bitCount)[0]!,
      rising: cell.params.CLK_POLARITY === 1,
      en,
      data: indices(cell, 'DATA', bitCount),
      addr: indices(cell, 'ADDR', bitCount),
      offset,
      earlier: Int32Array.from(earlier),
      wins: Uint8Array.from(earlier, (_, j) => (priority[j] === '1' ? 1 : 0)),
    };
    offset += en.length;
    return port;
  });
}

/**
 * What the write ports' edges sampled, between the two phases: per bit its enable and data (0,
 * 1, `X`), per port its address (`high`: bits 32 and up, as `readAddress` has them).
 */
export interface WriteSamples {
  readonly en: Uint8Array;
  readonly data: Uint8Array;
  readonly addr: Float64Array;
  readonly addrX: Float64Array;
  readonly high: Uint8Array;
}

export function newWriteSamples(ports: readonly WritePort[]): WriteSamples {
  const last = ports[ports.length - 1];
  const bits = last ? last.offset + last.en.length : 0;
  return {
    en: new Uint8Array(bits),
    data: new Uint8Array(bits),
    addr: new Float64Array(ports.length),
    addrX: new Float64Array(ports.length),
    high: new Uint8Array(ports.length),
  };
}

/**
 * Samples what port `p`'s edge writes from the planes (phase one). An uncertain edge may write:
 * its enabled bits become maybe-enabled (`X`).
 */
export function sampleWrite(
  ports: readonly WritePort[],
  p: number,
  uncertain: boolean,
  val: Uint8Array,
  unk: Uint8Array,
  s: WriteSamples,
): void {
  const wp = ports[p]!;
  for (let i = 0; i < wp.en.length; i++) {
    const e = tri(val, unk, wp.en[i]!);
    s.en[wp.offset + i] = uncertain && e !== 0 ? TX : e;
    s.data[wp.offset + i] = tri(val, unk, wp.data[i]!);
  }
  readAddress(val, unk, wp.addr);
  s.addr[p] = address[0]!;
  s.addrX[p] = address[1]!;
  s.high[p] = address[2]!;
}

/** Marks port `p`'s sample as clocked without end: every bit it may write becomes `X`. */
export function spoilWrite(ports: readonly WritePort[], p: number, s: WriteSamples): void {
  const wp = ports[p]!;
  for (let i = wp.offset; i < wp.offset + wp.en.length; i++) {
    if (s.en[i] !== 0) {
      s.en[i] = TX;
      s.data[i] = TX;
    }
  }
}

/** Whether port `p`'s sample may store `X`: a bit maybe enabled, or enabled with unknown data or address. */
export function writesUnknown(ports: readonly WritePort[], p: number, s: WriteSamples): boolean {
  if (s.high[p] === HIGH_ONE) return false;
  const wp = ports[p]!;
  const anywhere = s.addrX[p] !== 0 || s.high[p] === HIGH_UNKNOWN;
  for (let i = wp.offset; i < wp.offset + wp.en.length; i++) {
    const e = s.en[i];
    if (e === 0) continue;
    if (e === TX || s.data[i] === TX || anywhere) return true;
  }
  return false;
}

/**
 * Merges port `p`'s sample in `other` (the same edge seen at another moment of a race) into `s`:
 * the enables and data that differ become `X`, the address bits that differ unknown. Says whether
 * anything differed.
 */
export function mergeWrite(
  ports: readonly WritePort[],
  p: number,
  s: WriteSamples,
  other: WriteSamples,
): boolean {
  const wp = ports[p]!;
  let differ = false;
  for (let i = wp.offset; i < wp.offset + wp.en.length; i++) {
    if (s.en[i] !== other.en[i]) {
      s.en[i] = TX;
      differ = true;
    }
    if (s.data[i] !== other.data[i]) {
      s.data[i] = TX;
      differ = true;
    }
  }
  const x = (s.addrX[p]! | other.addrX[p]! | (s.addr[p]! ^ other.addr[p]!)) >>> 0;
  if (x !== s.addrX[p]) {
    s.addrX[p] = x;
    s.addr[p] = (s.addr[p]! & ~x) >>> 0;
    differ = true;
  }
  if (s.high[p] !== other.high[p]) {
    s.high[p] = HIGH_UNKNOWN;
    differ = true;
  }
  return differ;
}

/** Whether port `q`'s sample may write word `w` of its memory. */
function mayHit(q: number, s: WriteSamples, w: number, base: number): boolean {
  if (s.high[q] === HIGH_ONE) return false;
  const x = s.addrX[q]!;
  return (((w + base) ^ s.addr[q]!) & ~x) >>> 0 === 0;
}

/** Stores bit `i` of port `p`'s sample into word `w`; `certain`: the write surely hits it. */
function storeWord(
  ports: readonly WritePort[],
  p: number,
  s: WriteSamples,
  pending: Uint8Array,
  memory: CompiledMemory,
  words: Uint32Array,
  unknown: Uint32Array,
  w: number,
  certain: boolean,
): void {
  const wp = ports[p]!;
  const at = w * memory.limbs;
  for (let i = 0; i < memory.width; i++) {
    const e = s.en[wp.offset + i]!;
    if (e === 0) continue;
    const d = s.data[wp.offset + i]!;
    const limb = at + (i >>> 5);
    const bit = 1 << (i & 31);
    const cur = unknown[limb]! & bit ? TX : words[limb]! & bit ? 1 : 0;
    let t = e === 1 && certain ? d : merge(cur, d);
    // An earlier port of this edge that may write this bit, and this one doesn't win over: a
    // collision, `X` where the two differ (`cur` holds what that port stored).
    for (let k = 0; k < wp.earlier.length && t !== TX; k++) {
      const q = wp.earlier[k]!;
      if (wp.wins[k] || !pending[q]) continue;
      if (s.en[ports[q]!.offset + i] !== 0 && mayHit(q, s, w, memory.base)) {
        t = merge(cur, d);
      }
    }
    if (t === TX) {
      unknown[limb] = unknown[limb]! | bit;
      words[limb] = words[limb]! & ~bit;
    } else {
      unknown[limb] = unknown[limb]! & ~bit;
      words[limb] = t ? words[limb]! | bit : words[limb]! & ~bit;
    }
  }
}

/**
 * Stores port `p`'s sampled write into its memory at `now` (phase two), stamping the words it
 * may have written. `pending` marks the write ports storing at this edge: see `storeWord`.
 */
export function storeWrite(
  ports: readonly WritePort[],
  p: number,
  s: WriteSamples,
  pending: Uint8Array,
  memories: readonly CompiledMemory[],
  state: MemoryState,
  now: number,
): void {
  const wp = ports[p]!;
  if (s.high[p] === HIGH_ONE) return;
  let enabled = false;
  for (let i = wp.offset; i < wp.offset + wp.en.length && !enabled; i++) enabled = s.en[i] !== 0;
  if (!enabled) return;
  const memory = memories[wp.memory]!;
  const words = state.mval[wp.memory]!;
  const unknown = state.munk[wp.memory]!;
  const written = state.writtenAt[wp.memory]!;
  const { base, size } = memory;
  const x = s.addrX[p]!;
  const certain = x === 0 && s.high[p] === HIGH_ZERO;
  const known = (s.addr[p]! & ~x) >>> 0;
  if (x === 0) {
    const w = known - base;
    if (w < 0 || w >= size) return;
    written[w] = now;
    storeWord(ports, p, s, pending, memory, words, unknown, w, certain);
  } else if (2 ** popCount(x) <= size) {
    let subset = 0;
    do {
      const w = ((known | subset) >>> 0) - base;
      if (w >= 0 && w < size) {
        written[w] = now;
        storeWord(ports, p, s, pending, memory, words, unknown, w, false);
      }
      subset = nextSubset(subset, x);
    } while (subset !== 0);
  } else {
    // More candidates than words: look at each word.
    for (let w = 0; w < size; w++) {
      if (((w + base) & ~x) >>> 0 !== known) continue;
      written[w] = now;
      storeWord(ports, p, s, pending, memory, words, unknown, w, false);
    }
  }
}

/**
 * Stamps the words the read ports read (`readWord`) as read at `now`: when a port moved to
 * another word, or its word was written since — never for a mere re-run of the steps.
 */
export function stampReads(readMemory: Int32Array, state: MemoryState, now: number): void {
  for (let p = 0; p < readMemory.length; p++) {
    const w = state.readWord[p]!;
    if (w < 0) {
      state.stampedWord[p] = -1;
      continue;
    }
    const m = readMemory[p]!;
    const readAt = state.readAt[m]!;
    if (w !== state.stampedWord[p] || state.writtenAt[m]![w]! > readAt[w]!) {
      readAt[w] = now;
      state.stampedWord[p] = w;
    }
  }
}
