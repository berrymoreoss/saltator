/**
 * A module's timing as a part shows it (HDL-2): its `specify` paths and checks as a `TimingDef`
 * keyed by its ports — `tpd(CP↑ → Q)`, `tPLH(A → Y)`, `tsu(D → CP↑)`, `tW(CP HIGH)` — the
 * delays' typical values in `typical` and maxima in `max`, the checks' limits (guaranteed
 * minima) in `min`. The bits of one port are one entry. Spec: docs/components.md#verilog-modules-hdl.
 */
import type { HdlBit, HdlCheck, HdlModule, Time, TimingDef } from '../../core';

/** Where a module's numbers come from: `TimingDef.conditions` and `source`. */
export interface HdlTimingInfo {
  readonly conditions: string;
  readonly source: string;
}

const SYMBOLS: Readonly<Record<HdlCheck['kind'], string>> = {
  setup: 'tsu',
  hold: 'th',
  recovery: 'trec',
  removal: 'trem',
  width: 'tW',
};

/** The module's timing; undefined without a `specify` block. */
export function hdlTiming(module: HdlModule, info: HdlTimingInfo): TimingDef | undefined {
  const specify = module.specify;
  if (!specify) return undefined;
  const inName = new Map<number, string>();
  const outName = new Map<number, string>();
  for (const port of module.ports) {
    for (const bit of port.bits) {
      if (typeof bit !== 'number') continue;
      if (port.dir !== 'out' && !inName.has(bit)) inName.set(bit, port.name);
      if (port.dir !== 'in' && !outName.has(bit)) outName.set(bit, port.name);
    }
  }
  const names = (bits: readonly number[], of: ReadonlyMap<number, string>) =>
    [...new Set(bits.map((b) => of.get(b) ?? '?'))].join(', ');
  /** A condition: a pin's name, its inverse (`!OEn`), or `…` for other logic. */
  const condition = (when: HdlBit | undefined): string => {
    if (when === undefined) return '';
    const pin = typeof when === 'number' ? inName.get(when) : undefined;
    if (pin) return `, if ${pin}`;
    const inverter = module.cells.find(
      (c) => (c.type === '$not' || c.type === '$logic_not') && c.ports.Y?.[0] === when,
    );
    const inverted =
      inverter?.ports.A?.length === 1 ? inName.get(inverter.ports.A[0] as number) : undefined;
    return inverted ? `, if !${inverted}` : ', if …';
  };
  const arrow = (edge: string | undefined) => (edge === 'rise' ? '↑' : edge === 'fall' ? '↓' : '');

  const typical: Record<string, Time> = {};
  const max: Record<string, Time> = {};
  const min: Record<string, Time> = {};
  /** Sets `key`; a key already set to another value gets the source location too. */
  const put = (record: Record<string, Time>, key: string, value: Time, src: string) => {
    const k = key in record && record[key] !== value ? `${key} at ${src}` : key;
    record[k] = value;
    return k;
  };

  for (const path of specify.paths) {
    const base = `${names(path.from, inName)}${arrow(path.edge)} → ${names(path.to, outName)}${condition(path.when)}`;
    if (path.rise.typ === path.fall.typ && path.rise.max === path.fall.max) {
      const key = put(typical, `tpd(${base})`, path.rise.typ, path.src);
      max[key] = path.rise.max;
    } else {
      max[put(typical, `tPLH(${base})`, path.rise.typ, path.src)] = path.rise.max;
      max[put(typical, `tPHL(${base})`, path.fall.typ, path.src)] = path.fall.max;
    }
  }
  for (const check of specify.checks) {
    const clock = `${names(check.clock.bits, inName)}`;
    const key =
      check.kind === 'width'
        ? `tW(${clock} ${check.clock.edge === 'rise' ? 'HIGH' : 'LOW'}${condition(check.clock.when)})`
        : `${SYMBOLS[check.kind]}(${names(check.data.bits, inName)}${arrow(check.data.edge)} → ${clock}${arrow(check.clock.edge)}${condition(check.clock.when)})`;
    put(min, key, check.limit, check.src);
  }
  return {
    typical,
    ...(Object.keys(max).length > 0 && { max }),
    ...(Object.keys(min).length > 0 && { min }),
    conditions: info.conditions,
    source: info.source,
  };
}
