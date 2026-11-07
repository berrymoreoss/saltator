/**
 * Memory image files, as EEPROM programmers and assemblers read and write them: raw binary
 * (`.bin`) and Intel HEX (`.hex`). A file is read into chunks of bytes at their addresses, then
 * placed into a memory at an address of the designer's choosing. Pure: the editor's Load Image
 * dialog, test bench setups and the toolchain use the same code. Spec:
 * docs/components.md#image-files.
 */
import { ERASED } from './memory';

export type ImageFormat = 'binary' | 'intel-hex';

/** Bytes at consecutive addresses from `address` on. */
export interface ImageChunk {
  readonly address: number;
  readonly bytes: Uint8Array;
}

/** What an image file holds: chunks in address order, never overlapping or touching. */
export interface ImageFile {
  readonly format: ImageFormat;
  readonly chunks: readonly ImageChunk[];
  /** The start address an Intel HEX file names (record 03 or 05); not used for memories. */
  readonly start?: number;
}

/** A file's extent, for the Load Image dialog: what a programmer shows before it writes. */
export interface ImageSummary {
  /** The lowest and highest address holding a byte. */
  readonly low: number;
  readonly high: number;
  /** How many bytes the file holds (gaps between chunks not counted). */
  readonly bytes: number;
  /** The sum of the file's bytes, 16 bits (programmer software shows it as the checksum). */
  readonly checksum: number;
}

/** A file that can't be read: the reason, with its line for Intel HEX. */
export class ImageFileError extends Error {
  override readonly name = 'ImageFileError';
}

const HEX_EXTENSIONS = /\.(hex|ihx|ihex|mcs)$/i;
const HEX_LINE = /^:[0-9A-Fa-f]+$/;

/**
 * The format of a file: Intel HEX by its extension (`.hex`, `.ihx`, `.ihex`, `.mcs`) or, for
 * any other name, when its first line is a hex record; binary otherwise.
 */
export function detectImageFormat(name: string, bytes: Uint8Array): ImageFormat {
  if (HEX_EXTENSIONS.test(name)) return 'intel-hex';
  let end = 0;
  while (end < bytes.length && end < 600 && bytes[end] !== 0x0a && bytes[end] !== 0x0d) end++;
  let text = '';
  for (let i = 0; i < end; i++) text += String.fromCharCode(bytes[i]!);
  return HEX_LINE.test(text.trim()) ? 'intel-hex' : 'binary';
}

/** Reads a file in `format` (from `detectImageFormat`); throws `ImageFileError`. */
export function readImageFile(format: ImageFormat, bytes: Uint8Array): ImageFile {
  if (format === 'binary') return readBinaryImage(bytes);
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  return readIntelHex(text);
}

/** A binary file: every byte, from address 0. */
export function readBinaryImage(bytes: Uint8Array): ImageFile {
  if (bytes.length === 0) throw new ImageFileError('the file is empty');
  return { format: 'binary', chunks: [{ address: 0, bytes: bytes.slice() }] };
}

function hexByte(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

/** `0x01FF`: at least 4 digits. */
export function formatAddress(address: number): string {
  return `0x${address.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Reads Intel HEX: data (00), end of file (01), extended segment (02) and linear (04)
 * addresses, start addresses (03, 05; kept, not used). Every record's checksum is checked; a
 * record's data wraps within its 64 KB segment, as the format says. Blank lines are skipped,
 * anything after the end-of-file record ignored. Throws `ImageFileError` naming the line.
 */
export function readIntelHex(text: string): ImageFile {
  const records: { address: number; bytes: Uint8Array; line: number }[] = [];
  let base = 0;
  let start: number | undefined;
  let ended = false;
  const lines = text.split(/\r\n|\r|\n/);
  for (let n = 0; n < lines.length && !ended; n++) {
    const line = lines[n]!.trim();
    const fail = (why: string): never => {
      throw new ImageFileError(`line ${n + 1}: ${why}`);
    };
    if (line === '') continue;
    if (!line.startsWith(':')) fail('a record starts with ":"');
    if (!HEX_LINE.test(line) || line.length % 2 === 0) fail('a record is ":" and hex digit pairs');
    const raw = new Uint8Array((line.length - 1) / 2);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = Number.parseInt(line.slice(1 + 2 * i, 3 + 2 * i), 16);
    }
    if (raw.length < 5) fail('too short for a record');
    const count = raw[0]!;
    if (raw.length !== count + 5) {
      fail(`the record says ${count} data bytes but has ${raw.length - 5}`);
    }
    let sum = 0;
    for (let i = 0; i < raw.length - 1; i++) sum += raw[i]!;
    const expected = (0x100 - (sum & 0xff)) & 0xff;
    const checksum = raw[raw.length - 1]!;
    if (checksum !== expected) {
      fail(`checksum 0x${hexByte(checksum)}, expected 0x${hexByte(expected)}`);
    }
    const offset = (raw[1]! << 8) | raw[2]!;
    const type = raw[3]!;
    const data = raw.subarray(4, 4 + count);
    const word = (i: number) => (data[i]! << 8) | data[i + 1]!;
    const needs = (bytes: number) => {
      if (count !== bytes) fail(`a type 0${type} record has ${bytes} data bytes, not ${count}`);
    };
    switch (type) {
      case 0x00:
        // Data wraps within its 64 KB segment: split a record that crosses the top.
        for (let i = 0; i < count; ) {
          const low = (offset + i) & 0xffff;
          const run = Math.min(count - i, 0x10000 - low);
          records.push({ address: base + low, bytes: data.slice(i, i + run), line: n + 1 });
          i += run;
        }
        break;
      case 0x01:
        needs(0);
        ended = true;
        break;
      case 0x02:
        needs(2);
        base = word(0) * 16;
        break;
      case 0x03:
        needs(4);
        start = word(0) * 16 + word(2);
        break;
      case 0x04:
        needs(2);
        base = word(0) * 0x10000;
        break;
      case 0x05:
        needs(4);
        start = word(0) * 0x10000 + word(2);
        break;
      default:
        fail(`unknown record type 0x${hexByte(type)}`);
    }
  }
  if (!ended) throw new ImageFileError('no end-of-file record (":00000001FF")');
  if (records.length === 0) throw new ImageFileError('the file holds no data');
  records.sort((a, b) => a.address - b.address);
  const chunks: ImageChunk[] = [];
  let chunk: { address: number; parts: Uint8Array[]; end: number } | undefined;
  let last = records[0]!;
  const flush = () => {
    if (chunk)
      chunks.push({
        address: chunk.address,
        bytes: concat(chunk.parts, chunk.end - chunk.address),
      });
  };
  for (const record of records) {
    if (chunk && record.address < chunk.end) {
      const [first, second] = record.line < last.line ? [record, last] : [last, record];
      throw new ImageFileError(
        `line ${second.line}: overlaps the data of line ${first.line} at ${formatAddress(record.address)}`,
      );
    }
    if (chunk && record.address === chunk.end) {
      chunk.parts.push(record.bytes);
      chunk.end += record.bytes.length;
    } else {
      flush();
      chunk = {
        address: record.address,
        parts: [record.bytes],
        end: record.address + record.bytes.length,
      };
    }
    last = record;
  }
  flush();
  return { format: 'intel-hex', chunks, ...(start !== undefined && { start }) };
}

function concat(parts: readonly Uint8Array[], length: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** Where a file's bytes lie and their sum. */
export function summarizeImage(file: ImageFile): ImageSummary {
  let bytes = 0;
  let sum = 0;
  for (const chunk of file.chunks) {
    bytes += chunk.bytes.length;
    for (const b of chunk.bytes) sum += b;
  }
  const first = file.chunks[0]!;
  const last = file.chunks[file.chunks.length - 1]!;
  return {
    low: first.address,
    high: last.address + last.bytes.length - 1,
    bytes,
    checksum: sum & 0xffff,
  };
}

/**
 * Where a file's lowest address should land in a memory of `words` by default: that address
 * modulo the memory's size, as a chip whose upper address lines aren't connected sees it — its
 * own address in a memory it fits, 0 for a BE6502 ROM assembled for 0x8000 in an AT28C256.
 */
export function suggestedLoadAddress(summary: ImageSummary, words: number): number {
  return summary.low % words;
}

/** How to place a file into a memory. */
export interface PlaceOptions {
  /** Where the file's lowest address lands. */
  readonly at: number;
  /** Fill every byte the file doesn't cover with 0xFF, as a programmer erases before writing. */
  readonly eraseRest: boolean;
}

/**
 * The writes that place `file` into a memory of `words`: its chunks moved so its lowest
 * address lands at `at`, or, with `eraseRest`, the whole memory with the file's bytes in an
 * erased background (one write from 0). Returns the problem instead when the file doesn't fit.
 */
export function placeImage(
  file: ImageFile,
  words: number,
  { at, eraseRest }: PlaceOptions,
): ImageChunk[] | string {
  const { low, high } = summarizeImage(file);
  const last = words - 1;
  if (!Number.isInteger(at) || at < 0 || at > last) {
    return `the load address must be ${formatAddress(0)}–${formatAddress(last)}`;
  }
  const end = at + (high - low);
  if (end > last) {
    return `the file covers ${high - low + 1} addresses from ${formatAddress(at)}, past the last address ${formatAddress(last)} by ${end - last}`;
  }
  const moved = file.chunks.map((c) => ({ address: c.address - low + at, bytes: c.bytes }));
  if (!eraseRest) return moved;
  const bytes = new Uint8Array(words).fill(ERASED);
  for (const chunk of moved) bytes.set(chunk.bytes, chunk.address);
  return [{ address: 0, bytes }];
}

/** Applies `writes` to `bytes` in place (a ROM's contents), returning it. */
export function applyImageWrites(bytes: Uint8Array, writes: readonly ImageChunk[]): Uint8Array {
  for (const write of writes) bytes.set(write.bytes, write.address);
  return bytes;
}

/**
 * A memory's cells as a binary file. Unknown bits are written as 0; `unknownBytes` counts the
 * bytes that had any.
 */
export function memoryBytes(
  data: Uint8Array,
  unknown: Uint8Array,
): { bytes: Uint8Array; unknownBytes: number } {
  const bytes = new Uint8Array(data.length);
  let unknownBytes = 0;
  for (let i = 0; i < data.length; i++) {
    const x = unknown[i]!;
    if (x !== 0) unknownBytes++;
    bytes[i] = data[i]! & ~x;
  }
  return { bytes, unknownBytes };
}

/** Options for writing Intel HEX. */
export interface IntelHexOptions {
  /** The file address of `bytes[0]` (default 0): a ROM mapped at 0x8000 saved at 0x8000. */
  readonly base?: number;
  /** Leave out records whose bytes are all erased (0xFF); a programmer fills them back. */
  readonly omitErased?: boolean;
}

const RECORD_BYTES = 16;

/**
 * Writes Intel HEX: 16 data bytes per record, an extended linear address (04) record whenever
 * the upper 16 address bits change (none below 64 KB), the end-of-file record, `\n` line ends.
 */
export function writeIntelHex(bytes: Uint8Array, options: IntelHexOptions = {}): string {
  const base = options.base ?? 0;
  const lines: string[] = [];
  let upper = 0;
  const record = (count: number, offset: number, type: number, data: ArrayLike<number>) => {
    let sum = count + (offset >> 8) + (offset & 0xff) + type;
    let text = `:${hexByte(count)}${hexByte(offset >> 8)}${hexByte(offset & 0xff)}${hexByte(type)}`;
    for (let i = 0; i < data.length; i++) {
      sum += data[i]!;
      text += hexByte(data[i]!);
    }
    lines.push(text + hexByte((0x100 - (sum & 0xff)) & 0xff));
  };
  for (let i = 0; i < bytes.length; ) {
    const address = base + i;
    // A record stays within one 64 KB segment and one 16-byte line of the address space.
    const count = Math.min(RECORD_BYTES - (address % RECORD_BYTES), bytes.length - i);
    const data = bytes.subarray(i, i + count);
    i += count;
    if (options.omitErased && data.every((b) => b === ERASED)) continue;
    const high = Math.floor(address / 0x10000);
    if (high !== upper) {
      record(2, 0, 0x04, [high >> 8, high & 0xff]);
      upper = high;
    }
    record(count, address & 0xffff, 0x00, data);
  }
  record(0, 0, 0x01, []);
  return `${lines.join('\n')}\n`;
}
