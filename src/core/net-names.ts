/**
 * Net and bus names: what a name joining pins may be (net labels, bus entries), KiCad's vector
 * bus names (`D[0..7]`) and their members, and a bus value as text. Spec:
 * docs/components.md#net-labels-net.
 */
import { Level } from './logic';

/** One character of a net name. */
const NAME_CHAR = String.raw`[A-Za-z0-9_+\-/#]`;
/** A name's characters, with `~{…}` marking an overlined part. */
const NAME_BODY = `(?:${NAME_CHAR}|~\\{${NAME_CHAR}+\\})+`;
/** A bus index: 0…99, no leading zeros. */
const INDEX = '(?:0|[1-9][0-9]?)';

/**
 * What a net name may be: letters, digits, `_ + - / #`, and `~{…}` for an overline (KiCad's
 * syntax), at most 32 characters. No whitespace; no `.`, which netlists use to address pins
 * (`U1.Y`); no `[` `]`, which make bus names.
 */
export const NET_NAME = new RegExp(`^(?=.{1,32}$)${NAME_BODY}$`);

export const NET_NAME_HINT =
  'letters, digits, _ + - / # and ~{…} for an overline, at most 32 characters';

/**
 * What a bus name may be: a net name as its stem and a range of indices 0…99 either way round,
 * KiCad's vector bus (`D[0..7]`, `A[15..0]`), at most 32 characters. Its members (`D0`…`D7`) are
 * therefore net names too.
 */
export const BUS_NAME = new RegExp(`^(?=.{1,32}$)(${NAME_BODY})\\[(${INDEX})\\.\\.(${INDEX})\\]$`);

/** A net name or a bus name: what a net label may be called. */
export const LABEL_NAME = new RegExp(`${NET_NAME.source}|${BUS_NAME.source}`);

export const LABEL_NAME_HINT = `${NET_NAME_HINT}, or a bus such as D[0..7]`;

/** A bus name taken apart: `D[7..0]` → `{ stem: 'D', from: 7, to: 0 }`. */
export interface BusName {
  readonly stem: string;
  readonly from: number;
  readonly to: number;
}

/** The parts of a bus name, or `undefined` if `name` isn't one. */
export function parseBusName(name: string): BusName | undefined {
  const match = BUS_NAME.exec(name);
  if (!match) return undefined;
  const [, stem, from, to] = match as unknown as [string, string, string, string];
  return { stem, from: Number(from), to: Number(to) };
}

export function isBusName(name: string): boolean {
  return BUS_NAME.test(name);
}

/**
 * The member net names of a bus, least significant bit first whichever way the range is
 * written: `D[0..7]` and `D[7..0]` → `D0`…`D7`. Empty for a name that isn't a bus name.
 */
export function busMembers(name: string): string[] {
  const bus = parseBusName(name);
  if (!bus) return [];
  const lo = Math.min(bus.from, bus.to);
  const hi = Math.max(bus.from, bus.to);
  return Array.from({ length: hi - lo + 1 }, (_, i) => `${bus.stem}${lo + i}`);
}

const HEX = '0123456789ABCDEF';

/**
 * A bus value as text from its members' levels (least significant bit first): `0x3F`, one hex
 * digit per nibble, most significant first. A nibble whose bits all float shows `Z`, one with
 * any other unknown bit `X` (`0xZZ`, `0x3X`).
 */
export function busValueText(levels: readonly Level[]): string {
  let text = '';
  for (let lo = 0; lo < levels.length; lo += 4) {
    let digit = 0;
    let floating = 0;
    let unknown = false;
    const bits = Math.min(4, levels.length - lo);
    for (let bit = 0; bit < bits; bit++) {
      const level = levels[lo + bit]!;
      if (level === Level.L1) digit |= 1 << bit;
      else if (level === Level.Z) floating++;
      else if (level !== Level.L0) unknown = true;
    }
    const char = floating === bits ? 'Z' : unknown || floating > 0 ? 'X' : HEX[digit]!;
    text = char + text;
  }
  return `0x${text}`;
}
