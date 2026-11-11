/**
 * Every module the library's tests hold (HDL-10): the converter's fixtures that convert and pass
 * the analysis, and the differential tests' designs — for tests that run the same check over all
 * of them (the layout, the generated code against the cells' semantics).
 */
import type { HdlModule } from '../../core';
import { analyzeHdlModule } from './analyze';
import { DIFFERENTIAL } from './differential';
import { YOSYS_FIXTURES } from './fixtures';
import { fromYosys } from './from-yosys';

/** The modules by name: `fixture:<name>` and `differential:<name>`. */
export function sampleModules(): [string, HdlModule][] {
  const modules: [string, HdlModule][] = [];
  for (const [name, json] of Object.entries(YOSYS_FIXTURES)) {
    const { module } = fromYosys(JSON.parse(json));
    if (!module) continue;
    if (analyzeHdlModule(module).messages.some((m) => m.severity === 'error')) continue;
    modules.push([`fixture:${name}`, module]);
  }
  for (const [name, json] of Object.entries(DIFFERENTIAL)) {
    modules.push([`differential:${name}`, (JSON.parse(json) as { module: HdlModule }).module]);
  }
  return modules;
}
