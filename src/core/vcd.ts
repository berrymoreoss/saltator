/**
 * VCD (Value Change Dump, IEEE 1364 §18) from a recorder: the waveform view's export, read by
 * GTKWave, Surfer, PulseView and every HDL tool; headless test benches (R15) dump the same way.
 * Spec: docs/simulation.md#vcd-export.
 */
import type { Recorder } from './recorder';
import type { Time } from './time';

/** One variable of the dump: a 1-bit wire, or a vector of channels (bit 0 first). */
export interface VcdSignal {
  /** Display name (`CLK`, `~{RD}`, `D[0..7]`); made VCD-safe (`CLK`, `RD_n`, `D`). */
  readonly name: string;
  readonly channels: readonly number[];
}

export interface VcdOptions {
  /** First instant dumped (its values go in `$dumpvars`). Default: the recorder's `start`. */
  readonly from?: Time;
  /** Last instant dumped; a final `#to` marks it. Default: the recorder's `end`. */
  readonly to?: Time;
  /** `$scope module` name (the circuit's). Default `logic`. */
  readonly scope?: string;
  /** `$date` text, from the caller (core never reads the clock). Left out when absent. */
  readonly date?: string;
  /** `$version` text (the app and its version). Left out when absent. */
  readonly version?: string;
}

/**
 * A name VCD readers take as one reference: KiCad overlines `~{RD}` become `RD_n`, a bus's index
 * range `[0..7]` goes (the vector's `[7:0]` says it), anything else but letters, digits, `_`
 * and `$` becomes `_` (a `.` too: readers take it for a scope, `U1.Q0` → `U1_Q0`).
 */
export function vcdName(name: string): string {
  const plain = name
    .replace(/~\{([^}]*)\}/g, '$1_n')
    .replace(/\[\d+\.\.\d+\]$/, '')
    .replace(/[^A-Za-z0-9_$]/g, '_');
  return plain === '' ? '_' : /^[0-9$]/.test(plain) ? `_${plain}` : plain;
}

/** VCD identifier codes: printable ASCII `!` … `~`, then two characters, … */
export function vcdIdentifier(index: number): string {
  let code = '';
  let n = index;
  do {
    code += String.fromCharCode(33 + (n % 94));
    n = Math.floor(n / 94) - 1;
  } while (n >= 0);
  return code;
}

/** By `Level`: 0, 1, X, Z. */
const CHARS = ['0', '1', 'x', 'z'];

/** The VCD text of `signals` between `from` and `to`, at a 1 ps timescale. */
export function writeVcd(
  recorder: Recorder,
  signals: readonly VcdSignal[],
  options: VcdOptions = {},
): string {
  const from = Math.max(options.from ?? recorder.start, recorder.start);
  const to = Math.max(options.to ?? recorder.end, from);
  const lines: string[] = [];
  if (options.date !== undefined) lines.push('$date', `  ${options.date}`, '$end');
  if (options.version !== undefined) lines.push('$version', `  ${options.version}`, '$end');
  lines.push('$timescale 1ps $end', `$scope module ${vcdName(options.scope ?? 'logic')} $end`);

  const used = new Map<string, number>();
  const ids = signals.map((_, i) => vcdIdentifier(i));
  signals.forEach((signal, i) => {
    const base = vcdName(signal.name);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    const name = seen === 1 ? base : `${base}_${seen}`;
    const width = signal.channels.length;
    const range = width === 1 ? '' : ` [${width - 1}:0]`;
    lines.push(`$var wire ${width} ${ids[i]} ${name}${range} $end`);
  });
  lines.push('$upscope $end', '$enddefinitions $end');

  const char = (channel: number, t: Time) => {
    const level = recorder.level(channel, t);
    return level === undefined ? 'x' : CHARS[level]!;
  };
  const value = (signal: VcdSignal, id: string, t: Time) => {
    const { channels } = signal;
    if (channels.length === 1) return `${char(channels[0]!, t)}${id}`;
    let bits = '';
    for (let bit = channels.length - 1; bit >= 0; bit--) bits += char(channels[bit]!, t);
    return `b${bits} ${id}`;
  };

  // Values at `from`, then every instant in (from, to] where a channel changed: a k-way merge
  // over each channel's next change.
  const last = signals.map((signal, i) => value(signal, ids[i]!, from));
  lines.push(`#${from}`, '$dumpvars', ...last, '$end');
  const channels = [...new Set(signals.flatMap((s) => s.channels))];
  const cursor = channels.map((c) => recorder.indexAt(c, from) + 1);
  const signalsOf = new Map<number, number[]>();
  signals.forEach((signal, i) => {
    for (const c of signal.channels) {
      const list = signalsOf.get(c) ?? [];
      if (!list.includes(i)) list.push(i);
      signalsOf.set(c, list);
    }
  });
  let lastTime = from;
  for (;;) {
    let t = Number.POSITIVE_INFINITY;
    channels.forEach((c, k) => {
      if (cursor[k]! < recorder.changeCount(c)) t = Math.min(t, recorder.changeTime(c, cursor[k]!));
    });
    if (t > to) break;
    const touched = new Set<number>();
    channels.forEach((c, k) => {
      while (cursor[k]! < recorder.changeCount(c) && recorder.changeTime(c, cursor[k]!) === t) {
        cursor[k]!++;
        for (const s of signalsOf.get(c)!) touched.add(s);
      }
    });
    const changes: string[] = [];
    for (const s of [...touched].sort((a, b) => a - b)) {
      const text = value(signals[s]!, ids[s]!, t);
      if (text === last[s]) continue;
      last[s] = text;
      changes.push(text);
    }
    if (changes.length === 0) continue;
    lines.push(`#${t}`, ...changes);
    lastTime = t;
  }
  if (to > lastTime) lines.push(`#${to}`);
  return `${lines.join('\n')}\n`;
}
