import { describe, expect, it } from 'vitest';
import { yosysCommand, yosysScript } from './command';

describe('yosysScript', () => {
  it('reads, picks the top, keeps case statements as logic, flattens and writes JSON', () => {
    expect(yosysScript(['a.v', 'b.v'], 'out.json')).toBe(
      'read_verilog a.v b.v; hierarchy -auto-top; proc -norom; flatten; opt -keepdc; check; write_json out.json',
    );
  });
});

describe('yosysCommand', () => {
  it('is a quiet yosys run of the script', () => {
    expect(yosysCommand('decoder.v', 'decoder.json')).toBe(
      "yosys -q -p 'read_verilog decoder.v; hierarchy -auto-top; proc -norom; flatten; opt -keepdc; check; write_json decoder.json'",
    );
  });
});
