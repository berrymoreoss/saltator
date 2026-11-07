/**
 * Text ↔ value for the Properties panel's fields: what a prop shows while edited, and what typed
 * text means (or why it isn't valid). Pure.
 */
import { formatTime, type PropDef, type PropValue, parseTime } from '../core';

export type Parsed = { readonly value: PropValue } | { readonly error: string };

/** SI prefixes and their powers of ten. */
const PREFIXES = [
  ['G', 9],
  ['M', 6],
  ['k', 3],
  ['', 0],
  ['m', -3],
  ['µ', -6],
  ['n', -9],
  ['p', -12],
] as const;

/** A number with an SI prefix and unit, 4 significant digits: `4.7 kΩ`, `100 nF`, `1 Hz`. */
export function formatSi(value: number, unit = ''): string {
  const size = Math.abs(value);
  const [prefix, power] =
    size === 0
      ? ['', 0]
      : (PREFIXES.find(([, power]) => size >= 10 ** power * 0.99995) ?? PREFIXES.at(-1)!);
  return `${Number((value / 10 ** power).toPrecision(4))} ${prefix}${unit}`;
}

/**
 * Reads a number with an optional SI prefix (`G`, `M`, `k`, `m`, `µ` or `u`, `n`, `p`) and the
 * unit: `4.7k`, `4.7 kΩ`, `100n`, `1u`. Undefined if it isn't one.
 */
export function parseSi(text: string, unit = ''): number | undefined {
  const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `^([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)\\s*([GMkKmuµnp]?)\\s*(?:${escaped})?$`,
  ).exec(text.trim());
  if (!match) return undefined;
  const letter = match[2] === 'u' ? 'µ' : match[2] === 'K' ? 'k' : match[2]!;
  const power = PREFIXES.find(([prefix]) => prefix === letter)![1];
  // Shift the decimal exponent rather than multiply: `100n` is exactly 1e-7, not 1.0000000000000001e-7.
  const [mantissa, exponent = '0'] = match[1]!.toLowerCase().split('e') as [string, string?];
  return Number(`${mantissa}e${Number(exponent) + power}`);
}

/** The text a field starts with. */
export function propText(def: PropDef, value: PropValue | undefined): string {
  if (value === undefined) return '';
  if (def.type === 'time') return formatTime(Number(value));
  if (def.type === 'number' && def.si) return formatSi(Number(value), def.unit);
  return String(value);
}

function range(def: PropDef): string {
  const show = (n: number) => (def.si ? formatSi(n, def.unit) : String(n));
  if (def.min !== undefined && def.max !== undefined) {
    return `between ${show(def.min)} and ${show(def.max)}`;
  }
  if (def.min !== undefined) return `at least ${show(def.min)}`;
  return `at most ${show(def.max!)}`;
}

/** Reads typed text as a value of the prop's type, checking its limits. */
export function parsePropText(def: PropDef, text: string): Parsed {
  const trimmed = text.trim();
  switch (def.type) {
    case 'number':
    case 'integer': {
      // The unit may be typed after the number (`2.5 Hz`), with an SI prefix where allowed.
      const numeric = def.unit ? trimmed.replace(new RegExp(`\\s*${def.unit}$`, 'i'), '') : trimmed;
      const value = def.si ? (parseSi(trimmed, def.unit) ?? Number.NaN) : Number(numeric);
      if (numeric === '' || !Number.isFinite(value)) {
        return { error: def.si ? `Enter a value such as 4.7k or 100n.` : 'Enter a number.' };
      }
      if (def.type === 'integer' && !Number.isInteger(value)) {
        return { error: 'Enter a whole number.' };
      }
      if (
        (def.min !== undefined && value < def.min) ||
        (def.max !== undefined && value > def.max)
      ) {
        return { error: `Enter a number ${range(def)}.` };
      }
      return { value };
    }
    case 'time': {
      const value = parseTime(trimmed);
      if (value === undefined) return { error: 'Enter a time such as 10 ns, 1.5 µs or 2 ms.' };
      if (
        (def.min !== undefined && value < def.min) ||
        (def.max !== undefined && value > def.max)
      ) {
        const min = def.min !== undefined ? formatTime(def.min) : undefined;
        const max = def.max !== undefined ? formatTime(def.max) : undefined;
        return {
          error: `Enter a time ${min && max ? `between ${min} and ${max}` : min ? `of at least ${min}` : `of at most ${max}`}.`,
        };
      }
      return { value };
    }
    case 'boolean':
      return { value: trimmed === 'true' };
    case 'enum':
      return def.options?.some((o) => o.value === trimmed)
        ? { value: trimmed }
        : { error: 'Choose one of the options.' };
    case 'color':
    case 'string':
      return { value: text };
  }
}
