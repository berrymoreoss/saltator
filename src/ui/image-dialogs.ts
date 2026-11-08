/**
 * The Load Image and Save Image dialogs' pure parts: what a picked file holds, as a programmer
 * shows it before writing, and the bytes of a file to save. Spec: docs/editor.md#memory-tab.
 */

import type { Circuit } from '../circuit';
import type { ComponentRegistry } from '../core';
import {
  detectImageFormat,
  formatAddress,
  type ImageFile,
  ImageFileError,
  type ImageFormat,
  type ImageSummary,
  readImageFile,
  summarizeImage,
  writeIntelHex,
} from '../core';
import type { ImageFileKind } from './files';

/** A picked file, read: its format, its chunks and their extent. */
export interface ImageFileInfo {
  readonly name: string;
  readonly format: ImageFormat;
  readonly file: ImageFile;
  readonly summary: ImageSummary;
}

/** Reads a picked file, or says why it can't be loaded. */
export function readImageForLoad(name: string, bytes: Uint8Array): ImageFileInfo | string {
  const format = detectImageFormat(name, bytes);
  try {
    const file = readImageFile(format, bytes);
    return { name, format, file, summary: summarizeImage(file) };
  } catch (error) {
    if (error instanceof ImageFileError) return `${name}: ${error.message}`;
    throw error;
  }
}

/** A memory a test bench can load: a memory part of the circuit. */
export interface BenchMemory {
  /** Its designator, as a script names it. */
  readonly id: string;
  /** The part's name (`6116`). */
  readonly name: string;
  readonly words: number;
  readonly volatile: boolean;
}

/** The memory parts of a circuit, by designator (a script names ones in instances by path). */
export function circuitMemories(circuit: Circuit, registry: ComponentRegistry): BenchMemory[] {
  return circuit.components
    .flatMap((c) => {
      const definition = registry.get(c.type);
      const memory = definition?.memory;
      return definition && memory
        ? [{ id: c.id, name: definition.name, words: memory.words, volatile: memory.volatile }]
        : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/** Bytes per line of an inserted image: the Memory tab's rows. */
const PER_LINE = 16;

/**
 * What Insert Image… writes into a test script (R15b): a binary image as `b.memory` at `at` (hex
 * text, sixteen bytes a line), an Intel HEX file as `b.loadIntelHex` with its records as they
 * are (each one where the file puts it); a comment names the file. `raw` is the file's bytes.
 */
export function benchImageCall(
  ref: string,
  info: ImageFileInfo,
  raw: Uint8Array,
  at: number,
): string {
  const name = quote(ref);
  const facts = `${info.name}: ${describeImage(info.summary)}`;
  if (info.format === 'intel-hex') {
    const records = new TextDecoder()
      .decode(raw)
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    return [`b.loadIntelHex(${name}, \``, ...records.map((r) => `  ${r}`), `\`); // ${facts}`].join(
      '\n',
    );
  }
  const bytes = info.file.chunks.flatMap((c) => [...c.bytes]);
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += PER_LINE) {
    const row = bytes
      .slice(i, i + PER_LINE)
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'));
    lines.push(`  ${row.join(' ')}`);
  }
  return [`b.memory(${name}, ${formatAddress(at)}, \``, ...lines, `\`); // ${facts}`].join('\n');
}

/** A JavaScript string literal of `text` in single quotes. */
function quote(text: string): string {
  return `'${text.replace(/[\\']/g, '\\$&')}'`;
}

export const FORMAT_LABELS: Readonly<Record<ImageFormat, string>> = {
  binary: 'Binary',
  'intel-hex': 'Intel HEX',
};

/** `0x8000–0xFFFF · 32768 bytes · sum 0x1A2B`. */
export function describeImage({ low, high, bytes, checksum }: ImageSummary): string {
  const sum = checksum.toString(16).toUpperCase().padStart(4, '0');
  return `${formatAddress(low)}–${formatAddress(high)} · ${bytes} bytes · sum 0x${sum}`;
}

/** How to save a memory's bytes. */
export interface SaveImageOptions {
  readonly kind: ImageFileKind;
  /** Intel HEX: the file address of the first byte. */
  readonly base: number;
  /** Intel HEX: leave out lines whose bytes are all 0xFF. */
  readonly omitErased: boolean;
}

/** The file's bytes: the memory as it is (binary), or Intel HEX text. */
export function imageFileBytes(
  bytes: Uint8Array,
  { kind, base, omitErased }: SaveImageOptions,
): Uint8Array<ArrayBuffer> {
  if (kind === 'binary') return Uint8Array.from(bytes);
  return new TextEncoder().encode(writeIntelHex(bytes, { base, omitErased }));
}

/** `U3.bin`, `U3.hex`. */
export function imageFileName(id: string, kind: ImageFileKind): string {
  return `${id}.${kind === 'binary' ? 'bin' : 'hex'}`;
}
