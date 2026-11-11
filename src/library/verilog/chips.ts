/**
 * Library parts written in Verilog (HDL-2): a module compiled ahead of time (`modules.ts`, by
 * `pnpm hdl:library`) plus its data sheet's metadata — the hand-written chip's `ChipSpec` (pinout,
 * pin descriptions, units, function table) and the family's data sheet — its timing from the
 * module's `specify` block. The 74HC00, 74HC74 and 74HC574 prove the path against the
 * hand-written chips' tests; they are registered only in dev builds (`dev/*` types), next to the
 * hand-written ones. Spec: docs/components.md#library-parts-in-verilog.
 */
import {
  type AnyComponentDefinition,
  type HdlModule,
  hdlModuleProblems,
  pinIndex,
} from '../../core';
import { FF74_SPEC, GATE_SPECS, HC, REG574_SPEC } from '../74xx';
import type { ChipSpec } from '../74xx/chip';
import { dipPins } from '../74xx/pinout';
import { hdlLibraryPart, hdlPins, hdlTiming } from '../hdl';
import { LIBRARY_MODULES } from './modules';

/** A module of `modules.ts` by its source's name (`74hc00`). */
export function libraryModule(name: string): HdlModule {
  const entry = LIBRARY_MODULES[name];
  if (!entry) throw new Error(`no library module ${name} (run pnpm hdl:library)`);
  const module: unknown = JSON.parse(entry.ir);
  const problems = hdlModuleProblems(module);
  if (problems.length > 0) throw new Error(`${name}: ${problems.join('; ')}`);
  return module as HdlModule;
}

/**
 * The data sheet's pin name of a module pin: a port named like the data sheet's generic pin,
 * active-LOW ones ending in `n` (`SDn`), a section's bit `n − 1` its pin `n` when `numbered`
 * (`CP0` → `1CP`), else the bit as the data sheet's index (`D3` → `D3`).
 */
function sheetName(modulePin: string, numbered: boolean): string {
  const match = /^([A-Za-z]+?)n?(\d*)$/.exec(modulePin);
  if (!match) throw new Error(`module pin ${modulePin} has no data sheet name`);
  const [, base, index] = match;
  if (!numbered) return `${base}${index}`;
  return `${Number(index) + 1}${base}`;
}

/** The chip `spec` of the HC family written in Verilog (`file`.v). */
function verilogChip(spec: ChipSpec, file: string, numbered: boolean): AnyComponentDefinition {
  const module = libraryModule(file);
  const made = HC.chips[spec.number];
  if (!made) throw new Error(`74HC${spec.number}: no timing in the family`);
  const pins = dipPins(spec.pinCount, spec.pins);
  const at = hdlPins(module).map((pin) => pinIndex(pins, sheetName(pin.name, numbered)));
  const name = `74HC${spec.number}`;
  const timing = hdlTiming(module, {
    conditions: made.timing.conditions ?? '',
    source: `${made.timing.source}; src/library/verilog/${file}.v`,
  });
  return hdlLibraryPart(
    module,
    { pins, at },
    {
      type: `dev/${name.toLowerCase()}-verilog`,
      name,
      title: `${spec.title} (Verilog)`,
      keywords: [...spec.keywords, 'verilog'],
      datasheet: made.datasheet,
      package: { kind: 'dip', pins: spec.pinCount },
      ...(spec.units && { units: spec.units }),
      ...(timing && { timing }),
      functionTable: spec.functionTable,
    },
  );
}

let made: readonly AnyComponentDefinition[] | undefined;

/**
 * The Verilog 74HC00, 74HC74 and 74HC574 (dev builds and tests only), made on the first call: a
 * production build that never asks compiles nothing.
 */
export function verilogChips(): readonly AnyComponentDefinition[] {
  made ??= [
    verilogChip(GATE_SPECS.find((s) => s.number === '00')!, '74hc00', true),
    verilogChip(FF74_SPEC, '74hc74', true),
    verilogChip(REG574_SPEC, '74hc574', false),
  ];
  return made;
}
