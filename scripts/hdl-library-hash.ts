/**
 * The hash a library part's Verilog source is recorded with (HDL-2): SHA-256 of its text with
 * line endings made `\n`, so a checkout with CRLF endings doesn't look changed.
 */
import { createHash } from 'node:crypto';

export function librarySourceHash(text: string): string {
  return createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
}
