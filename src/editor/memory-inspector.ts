/**
 * The memory inspector's model (R12b): the memories of the circuit in the editor — chips, and
 * the memories of Verilog modules (HDL-6) — their cells — live from the simulator, a ROM's image
 * or a module memory's power-up contents while stopped — the address on their pins, how recently
 * each cell was read or written, and edits: a ROM's contents are its `image` prop (a document
 * edit), a simulated RAM or module memory takes debug writes (`poke`). No DOM: the Memory tab
 * renders it, and tests drive it with a fake clock. Spec: docs/editor.md#memory-inspector.
 */
import { compareDesignators, type Design, Resolver } from '../circuit';
import {
  applyImageWrites,
  busValueText,
  formatImage,
  type ImageChunk,
  Level,
  type MemoryDef,
  type MemoryView,
  type MemoryWords,
  memoryBytes,
  type PropDef,
  packWords,
  parseImage,
  pokeOf,
  resolveProps,
  toInput,
  type WordRun,
} from '../core';
import type { Editor } from './editor';
import type { SimClock } from './simulation';

/** One memory of the circuit, as the picker lists it. */
export interface MemoryEntry {
  /** The memory's reference: `U5`, `A1/U3`, a module's `A1/rom` (HDL-6). */
  readonly id: string;
  /** The part holding it, as the simulator names it (`A1/U1` for `A1/rom`). */
  readonly part: string;
  readonly type: string;
  /** What the part's definition says of it. */
  readonly memory: MemoryDef;
  /** The part's name: `AT28C16`. */
  readonly name: string;
  readonly words: number;
  readonly width: number;
  /** The address of word 0 (a module's `m[16:25]`: 16); 0 for a chip. */
  readonly offset: number;
  /** Its size in a file: a byte per word up to 8 bits, wider words little-endian (HDL-6). */
  readonly bytes: number;
  /** RAM: cells only while simulating. ROM: cells from its `image` prop. */
  readonly volatile: boolean;
  /** `U3 · AT28C16 · 2K × 8`. */
  readonly label: string;
  readonly addressPins: readonly string[];
}

/** What the inspector can show of a memory now. */
export type MemoryCells =
  /** The simulated instance's cells, read in place (never copied): changes as the run goes on. */
  | { readonly kind: 'live'; readonly view: MemoryView }
  /** A stopped ROM: the contents its image gives it at power-on. */
  | { readonly kind: 'image'; readonly data: Uint8Array }
  /** A stopped module's memory (HDL-6): the contents Yosys read, which every run starts from. */
  | { readonly kind: 'power-up'; readonly data: MemoryWords; readonly unknown: MemoryWords }
  /** Nothing to show, and why (a stopped RAM). */
  | { readonly kind: 'none'; readonly reason: string };

/** The address on a memory's pins: its value when every bit is known, and as text. */
export interface MemoryAddress {
  readonly value: number | undefined;
  /** `0x01F`; `X` and `Z` nibbles where bits are unknown or floating. */
  readonly text: string;
}

/** How long a cell stays lit after it was read or written, in ms of wall time. */
export const ACCESS_FADE_MS = 500;

/** Why a stopped RAM shows nothing. */
export const STOPPED_RAM =
  'A RAM holds data only while simulating. Step (F10) powers on at t = 0, paused, to edit or load it before running.';

/** Why a stopped module's memory can't be edited (HDL-6). */
export const STOPPED_MODULE_MEMORY =
  "A module's memory starts from what Yosys read (initial, $readmemh): change the .hex and Compile, or Step (F10) to power on at t = 0, paused, and edit or load it before running.";

/** Bytes a word takes in a file: 1 up to 8 bits, then little-endian (HDL-6). */
export const bytesPerWord = (width: number): number => Math.max(1, Math.ceil(width / 8));

/** `2K × 8`, `32K × 8`, `16 × 4`. */
export function memorySize(words: number, width: number): string {
  const count = words >= 1024 && words % 1024 === 0 ? `${words / 1024}K` : `${words}`;
  return `${count} × ${width}`;
}

const RING = 128;

/**
 * Simulated time against wall time, sampled once per frame: an access stamped at simulated time
 * `t` became visible at the wall time of the first frame that reached `t`, and fades from there.
 */
class AccessClock {
  readonly #sim = new Float64Array(RING);
  readonly #wall = new Float64Array(RING);
  #count = 0;
  #start = 0;
  /** Accesses at or before this simulated time are older than every sample kept. */
  #forgotten = -Infinity;

  /** Forgets the samples; accesses at or before `forgotten` (a rewind's instant) stay unlit. */
  clear(forgotten = -Infinity): void {
    this.#count = 0;
    this.#start = 0;
    this.#forgotten = forgotten;
  }

  get last(): number {
    return this.#count === 0 ? -Infinity : this.#sim[(this.#start + this.#count - 1) % RING]!;
  }

  get lastWall(): number {
    return this.#count === 0 ? -Infinity : this.#wall[(this.#start + this.#count - 1) % RING]!;
  }

  /** Records that the simulation reached `time` at `wall`; drops samples past the fade. */
  sample(time: number, wall: number): void {
    if (this.#count > 0 && time <= this.last) return;
    while (
      this.#count > 0 &&
      (this.#count === RING || wall - this.#wall[this.#start]! > ACCESS_FADE_MS)
    ) {
      // An access up to a dropped sample's time was seen at its frame or before: faded.
      this.#forgotten = this.#sim[this.#start]!;
      this.#start = (this.#start + 1) % RING;
      this.#count--;
    }
    const at = (this.#start + this.#count) % RING;
    this.#sim[at] = time;
    this.#wall[at] = wall;
    this.#count++;
  }

  /** 1 for an access in the latest frame, fading to 0 over `ACCESS_FADE_MS` after `reference`. */
  intensity(stamp: number, reference: number): number {
    if (stamp === -Infinity || stamp <= this.#forgotten || this.#count === 0) return 0;
    // The first frame that reached the stamp (the latest, for one after every sample).
    let lo = 0;
    let hi = this.#count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.#sim[(this.#start + mid) % RING]! >= stamp) hi = mid;
      else lo = mid + 1;
    }
    const age = reference - this.#wall[(this.#start + lo) % RING]!;
    return Math.min(1, Math.max(0, 1 - age / ACCESS_FADE_MS));
  }
}

export class MemoryInspector {
  readonly #editor: Editor;
  readonly #clock: SimClock;
  #design: Design | undefined;
  #entries: readonly MemoryEntry[] = [];
  readonly #images = new Map<string, { readonly text: string; readonly bytes: Uint8Array }>();
  readonly #accesses = new AccessClock();

  constructor(editor: Editor, clock: SimClock) {
    this.#editor = editor;
    this.#clock = clock;
    const simulation = editor.simulation;
    simulation.revision.subscribe(() => this.sample());
    simulation.status.subscribe(() => this.sample());
    // After a rewind the cells' stamps are as they were then: none of them is news.
    simulation.onRewind(({ time }) => this.#accesses.clear(time));
  }

  /** The memories of the design — inside instances by path (`A1/U3`) — in designator order. */
  memories(): readonly MemoryEntry[] {
    const { design } = this.#editor.state.get();
    if (design !== this.#design) {
      this.#design = design;
      const resolver = new Resolver(design, this.#editor.registry);
      this.#entries = resolver
        .memories()
        .map(({ id, part, type, definition, memory }) => ({
          id,
          part,
          type,
          memory,
          name: definition.name,
          words: memory.words,
          width: memory.width,
          offset: memory.offset ?? 0,
          bytes: memory.words * bytesPerWord(memory.width),
          volatile: memory.volatile,
          label: `${id} · ${definition.name} · ${memorySize(memory.words, memory.width)}`,
          addressPins: memory.addressPins ?? [],
        }))
        .sort((a, b) => compareDesignators(a.id, b.id));
    }
    return this.#entries;
  }

  entry(id: string): MemoryEntry | undefined {
    return this.memories().find((m) => m.id === id);
  }

  /**
   * The cells of memory `id`: live while simulating, a stopped ROM's image, a stopped module
   * memory's power-up contents, or why none.
   */
  cells(id: string): MemoryCells {
    const entry = this.entry(id);
    if (!entry) return { kind: 'none', reason: `No memory ${id} in the circuit.` };
    const sim = this.#editor.simulation.simulator;
    if (sim) return { kind: 'live', view: entry.memory.view(sim.stateOf(entry.part)) };
    const image = this.#image(id);
    if (image) return { kind: 'image', data: image.bytes };
    const powerUp = entry.memory.powerUp?.();
    return powerUp ? { kind: 'power-up', ...powerUp } : { kind: 'none', reason: STOPPED_RAM };
  }

  /** The address on the pins of memory `id` while simulating. */
  address(id: string): MemoryAddress | undefined {
    const entry = this.entry(id);
    const sim = this.#editor.simulation.simulator;
    if (!entry || !sim || entry.addressPins.length === 0) return undefined;
    const levels = entry.addressPins.map((pin) => {
      const level = sim.pinLevel(entry.part, pin);
      return level === Level.Z ? Level.Z : toInput(level);
    });
    let value: number | undefined = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i] === Level.L1) value += 2 ** i;
      else if (levels[i] !== Level.L0) value = undefined;
      if (value === undefined) break;
    }
    return { value, text: busValueText(levels) };
  }

  /**
   * How lit a cell stamped at `stamp` (`readAt`, `writtenAt`) is: 1 when accessed in the latest
   * frame, fading over `ACCESS_FADE_MS`; frozen while paused, so a step shows what it touched.
   */
  intensity(stamp: number): number {
    const running = this.#editor.simulation.state === 'running';
    return this.#accesses.intensity(stamp, running ? this.#clock.now() : this.#accesses.lastWall);
  }

  /** Whether anything may still be fading (the view keeps redrawing while it is). */
  get fading(): boolean {
    return (
      this.#editor.simulation.state === 'running' &&
      this.#clock.now() - this.#accesses.lastWall < ACCESS_FADE_MS
    );
  }

  /** Records the simulated time reached; the host's frames and state changes call it. */
  sample(): void {
    const sim = this.#editor.simulation.simulator;
    if (!sim || sim.now < this.#accesses.last) this.#accesses.clear();
    if (sim) this.#accesses.sample(sim.now, this.#clock.now());
  }

  /**
   * Writes `words` into memory `id` from word `address` on (its index: an address minus the
   * memory's `offset`): a ROM's image (one undo step; edits of one memory in a row coalesce), a
   * simulated RAM's or module memory's cells (a debug write, not undoable). Returns why not
   * instead.
   */
  write(id: string, address: number, words: readonly number[]): string | undefined {
    const entry = this.entry(id);
    if (!entry) return `No memory ${id} in the circuit.`;
    const max = 2 ** entry.width - 1;
    if (
      !Number.isInteger(address) ||
      address < 0 ||
      address + words.length > entry.words ||
      words.some((w) => !Number.isInteger(w) || w < 0 || w > max)
    ) {
      if (entry.width <= 8 && entry.offset === 0) {
        return `${id} holds bytes 0x00–0xFF at 0–${entry.words - 1}.`;
      }
      const digits = Math.ceil(entry.width / 4);
      const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(digits, '0')}`;
      const last = (entry.offset + entry.words - 1).toString(16).toUpperCase();
      return `${id} holds words ${hex(0)}–${hex(max)} at ${entry.offset.toString(16).toUpperCase()}–${last}.`;
    }
    if (entry.width > 8) return this.#poke(entry, [{ address, words }]);
    const chunk: ImageChunk = { address, bytes: Uint8Array.from(words) };
    return this.#apply(entry, [chunk], {
      label: `Edit ${id} contents`,
      coalesce: `memory:${id}`,
    });
  }

  /**
   * Writes one byte of a wider memory (HDL-6, its Bytes view): byte `lane` of word `address`,
   * little-endian; the word's other bits keep their value (unknown ones become 0).
   */
  writeByte(id: string, address: number, lane: number, value: number): string | undefined {
    const entry = this.entry(id);
    if (!entry) return `No memory ${id} in the circuit.`;
    const cells = this.cells(id);
    if (cells.kind !== 'live') return STOPPED_MODULE_MEMORY;
    if (!Number.isInteger(value) || value < 0 || value > 0xff) return 'A byte is 0x00–0xFF.';
    const known = ((cells.view.data[address] ?? 0) & ~(cells.view.unknown[address] ?? 0)) >>> 0;
    const shift = 2 ** (8 * lane);
    const word = known - (Math.floor(known / shift) % 256) * shift + value * shift;
    return this.write(id, address, [word % 2 ** entry.width]);
  }

  /**
   * Loads an image file's writes (`placeImage`, byte addresses from the memory's start) into
   * memory `id`, as one undo step for a ROM; into a wider memory packed little-endian (HDL-6).
   */
  load(id: string, writes: readonly ImageChunk[]): string | undefined {
    const entry = this.entry(id);
    if (!entry) return `No memory ${id} in the circuit.`;
    if (entry.width > 8) return this.#poke(entry, packWords(writes, bytesPerWord(entry.width)));
    return this.#apply(entry, writes, { label: `Load image into ${id}` });
  }

  /** Erases a ROM: every byte 0xFF. */
  erase(id: string): string | undefined {
    const entry = this.entry(id);
    if (!entry) return `No memory ${id} in the circuit.`;
    const key = this.#imageProp(entry)?.key;
    if (entry.volatile || key === undefined) return `${id} is a RAM: it can't be erased.`;
    return this.#editor.setPartProp(id, key, '', { label: `Erase ${id}` });
  }

  /**
   * The bytes to save from memory `id` (unknown bits as 0; wider words little-endian), or why
   * there are none.
   */
  contents(id: string): { bytes: Uint8Array; unknownBytes: number } | string {
    const cells = this.cells(id);
    if (cells.kind === 'none') return cells.reason;
    if (cells.kind === 'image') return { bytes: cells.data.slice(), unknownBytes: 0 };
    const { width } = this.entry(id)!;
    if (cells.kind === 'power-up') return memoryBytes(cells.data, cells.unknown, width);
    return memoryBytes(cells.view.data, cells.view.unknown, width);
  }

  /** Debug writes of words into a simulated memory (a RAM, a module's). */
  #poke(entry: MemoryEntry, runs: readonly WordRun[]): string | undefined {
    const simulation = this.#editor.simulation;
    if (!simulation.simulator) return entry.memory.powerUp ? STOPPED_MODULE_MEMORY : STOPPED_RAM;
    for (const { address, words } of runs) {
      if (address + words.length > entry.words) {
        return `${entry.id}: the image reaches past its last word.`;
      }
      if (!simulation.action(entry.part, pokeOf(entry.memory, address, words))) {
        return `${entry.id} can't be written now.`;
      }
    }
    return undefined;
  }

  #apply(
    entry: MemoryEntry,
    writes: readonly ImageChunk[],
    options: { label: string; coalesce?: string },
  ): string | undefined {
    const { id } = entry;
    if (entry.volatile) {
      return this.#poke(
        entry,
        writes.map(({ address, bytes }) => ({ address, words: Array.from(bytes) })),
      );
    }
    const image = this.#image(id);
    const key = this.#imageProp(entry)?.key;
    if (!image || key === undefined) return `${id} has no contents to edit.`;
    const text = formatImage(applyImageWrites(image.bytes.slice(), writes));
    // A ROM inside an instance: its circuit's image, shared by every instance of it.
    return this.#editor.setPartPropAt(id, key, text, options);
  }

  #imageProp(entry: MemoryEntry): PropDef | undefined {
    return this.#editor.registry.get(entry.type)?.props?.find((p) => p.type === 'image');
  }

  /** A ROM's contents from its image prop, parsed once per text. */
  #image(id: string): { readonly text: string; readonly bytes: Uint8Array } | undefined {
    const entry = this.entry(id);
    const definition = entry && this.#editor.registry.get(entry.type);
    const prop = entry && this.#imageProp(entry);
    const instance = this.#editor.partAt(id)?.part;
    if (!definition || !prop || !instance || entry.volatile) return undefined;
    const text = String(resolveProps(definition, instance.props, id)[prop.key] ?? '');
    const cached = this.#images.get(id);
    if (cached?.text === text) return cached;
    const image = { text, bytes: parseImage(text, entry.words) };
    this.#images.set(id, image);
    return image;
  }
}
