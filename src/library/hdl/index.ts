/**
 * Verilog modules (HDL-1, ADR-0030): the Yosys command, the converter from its JSON netlist to
 * the IR, the analysis and the interpreter that runs a module as a part.
 * Spec: docs/components.md#verilog-modules.
 */
export { analyzeHdlModule, bitName, type HdlAnalysis } from './analyze';
export { yosysCommand, yosysScript } from './command';
export { fromYosys, type YosysConversion } from './from-yosys';
export { hdlPart, hdlPins } from './module-part';
