/**
 * Text ↔ value for the Properties panel's fields: what a prop shows while edited, and what typed
 * text means (or why it isn't valid). Pure.
 */
import { formatTime, type PropDef, type PropValue, parseTime } from '../core';

export type Parsed = { readonly value: PropValue } | { readonly error: string };

/** The text a field starts with. */
export function propText(def: PropDef, value: PropValue | undefined): string {
  if (value === undefined) return '';
  if (def.type === 'time') return formatTime(Number(value));
  return String(value);
}

function range(def: PropDef): string {
  if (def.min !== undefined && def.max !== undefined) return `between ${def.min} and ${def.max}`;
  if (def.min !== undefined) return `at least ${def.min}`;
  return `at most ${def.max}`;
}

/** Reads typed text as a value of the prop's type, checking its limits. */
export function parsePropText(def: PropDef, text: string): Parsed {
  const trimmed = text.trim();
  switch (def.type) {
    case 'number':
    case 'integer': {
      // The unit may be typed after the number (`2.5 Hz`).
      const numeric = def.unit ? trimmed.replace(new RegExp(`\\s*${def.unit}$`, 'i'), '') : trimmed;
      const value = Number(numeric);
      if (numeric === '' || !Number.isFinite(value)) return { error: 'Enter a number.' };
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
