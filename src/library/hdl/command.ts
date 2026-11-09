/**
 * The Yosys command a module's JSON netlist is made with (HDL-1, ADR-0030): the user runs it on
 * their own computer, the repo's scripts run it with the system `yosys`. The converter accepts
 * what it produces. Spec: docs/components.md#verilog-modules-hdl.
 */

/**
 * The passes, in order: read the sources, pick the top module, turn processes into cells
 * (`-norom`: a `case` stays logic instead of becoming a ROM, which modules can't hold yet),
 * flatten the hierarchy, optimize without dropping don't-care bits (`-keepdc`, so `X` behaves
 * as written), report problems, write the JSON netlist.
 */
export function yosysScript(sources: readonly string[], output: string): string {
  return [
    `read_verilog ${sources.join(' ')}`,
    'hierarchy -auto-top',
    'proc -norom',
    'flatten',
    'opt -keepdc',
    'check',
    `write_json ${output}`,
  ].join('; ');
}

/** The whole command line for a terminal: `yosys -q -p '…'` (`-q`: only warnings and errors). */
export function yosysCommand(source = 'module.v', output = 'module.json'): string {
  return `yosys -q -p '${yosysScript([source], output)}'`;
}
