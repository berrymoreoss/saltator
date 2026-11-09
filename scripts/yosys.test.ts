import { describe, expect, it } from 'vitest';
import { scriptFor } from './yosys.ts';

describe('scriptFor', () => {
  it("is the command's script for an ordinary source", () => {
    expect(scriptFor('module m; endmodule\n', 'm.v', '/t/out.json')).toBe(
      'read_verilog m.v; hierarchy -auto-top; proc -norom; flatten; tribuf -logic; opt -keepdc; check; write_json /t/out.json',
    );
  });

  it("is the first line's override with {in} and {out} filled in", () => {
    const source =
      '// yosys: read_verilog {in}; synth -top g; write_json {out}\nmodule g; endmodule\n';
    expect(scriptFor(source, 'g.v', 'o.json')).toBe(
      'read_verilog g.v; synth -top g; write_json o.json',
    );
  });
});
