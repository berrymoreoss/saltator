/**
 * The Load Image and Save Image dialogs' pure parts: what a picked file holds, as a programmer
 * shows it before writing, and the bytes of a file to save. Spec: docs/editor.md#memory-tab.
 */
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
