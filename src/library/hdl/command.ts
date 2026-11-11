/**
 * The Yosys command a module's JSON netlist is made with (HDL-1, ADR-0030): the user runs it on
 * their own computer, the repo's scripts run it with the system `yosys`. The converter accepts
 * what it produces. Spec: docs/components.md#verilog-modules-hdl.
 */

/**
 * The passes, in order: read the sources, pick the top module, turn processes into cells
 * (`-norom`: a `case` stays logic, as a GAL gets it, instead of becoming a ROM), flatten the
 * hierarchy, turn tri-states into `$tribuf` cells (HDL-8: `-logic` merges the drivers of one net
 * into one and makes those that reach no port logic), optimize without dropping don't-care bits
 * (`-keepdc`, so `X` behaves as written), collect each memory's ports and contents into one cell
 * (HDL-6: reads stay asynchronous, a registered read's register a flip-flop), report problems,
 * write the JSON netlist.
 */
export function yosysScript(sources: readonly string[], output: string): string {
  return [
    `read_verilog ${sources.join(' ')}`,
    'hierarchy -auto-top',
    'proc -norom',
    'flatten',
    'tribuf -logic',
    'opt -keepdc',
    'memory_collect',
    'check',
    `write_json ${output}`,
  ].join('; ');
}

/** The whole command line for a terminal: `yosys -q -p '…'` (`-q`: only warnings and errors). */
export function yosysCommand(source = 'module.v', output = 'module.json'): string {
  return `yosys -q -p '${yosysScript([source], output)}'`;
}
