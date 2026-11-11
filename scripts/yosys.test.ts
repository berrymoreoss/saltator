import { describe, expect, it } from 'vitest';
import { scriptFor } from './yosys.ts';

describe('scriptFor', () => {
  it("is the command's script for an ordinary source", () => {
    expect(scriptFor('module m; endmodule\n', 'm.v', '/t/out.json')).toBe(
      'read_verilog m.v; hierarchy -auto-top; proc -norom; flatten; tribuf -logic; opt -keepdc; memory_collect; check; write_json /t/out.json',
    );
  });

  it('reads the other sources and names the top module of a design of several files', () => {
    const design = { with: ['picorv32.v'], top: 'soc' };
    expect(scriptFor('module soc; endmodule\n', 'soc.v', 'o.json', design)).toBe(
      'read_verilog soc.v picorv32.v; hierarchy -top soc; proc -norom; flatten; tribuf -logic; opt -keepdc; memory_collect; check; write_json o.json',
    );
    expect(
      scriptFor('// yosys: read_verilog {in}; write_json {out}\n', 'a.v', 'o.json', design),
    ).toBe('read_verilog a.v picorv32.v; write_json o.json');
  });

  it("is the first line's override with {in} and {out} filled in", () => {
    const source =
      '// yosys: read_verilog {in}; synth -top g; write_json {out}\nmodule g; endmodule\n';
    expect(scriptFor(source, 'g.v', 'o.json')).toBe(
      'read_verilog g.v; synth -top g; write_json o.json',
    );
  });
});
