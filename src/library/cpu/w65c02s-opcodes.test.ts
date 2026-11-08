import { describe, expect, it } from 'vitest';
import { type AddressingMode, MODE_BYTES, W65C02S_OPCODES } from './w65c02s-opcodes';

const op = (opcode: number) => {
  const info = W65C02S_OPCODES[opcode];
  if (!info) throw new Error(`no opcode ${opcode}`);
  return info;
};

describe('W65C02S opcode table', () => {
  it('has every opcode at its index, 212 of them instructions (§1.1)', () => {
    expect(W65C02S_OPCODES).toHaveLength(256);
    W65C02S_OPCODES.forEach((info, index) => {
      expect(info.opcode).toBe(index);
    });
    expect(W65C02S_OPCODES.filter((info) => !info.reserved)).toHaveLength(212);
  });

  it.each<[number, string, AddressingMode]>([
    [0x00, 'BRK', 's'],
    [0x0f, 'BBR0', 'zp,r'],
    [0x12, 'ORA', '(zp)'],
    [0x1a, 'INC', 'A'],
    [0x1c, 'TRB', 'a'],
    [0x20, 'JSR', 'a'],
    [0x34, 'BIT', 'zp,x'],
    [0x3a, 'DEC', 'A'],
    [0x3c, 'BIT', 'a,x'],
    [0x4c, 'JMP', 'a'],
    [0x5a, 'PHY', 's'],
    [0x64, 'STZ', 'zp'],
    [0x6c, 'JMP', '(a)'],
    [0x7a, 'PLY', 's'],
    [0x7c, 'JMP', '(a,x)'],
    [0x80, 'BRA', 'r'],
    [0x89, 'BIT', '#'],
    [0x96, 'STX', 'zp,y'],
    [0x9c, 'STZ', 'a'],
    [0x9e, 'STZ', 'a,x'],
    [0xa2, 'LDX', '#'],
    [0xa9, 'LDA', '#'],
    [0xb1, 'LDA', '(zp),y'],
    [0xbe, 'LDX', 'a,y'],
    [0xcb, 'WAI', 'i'],
    [0xd7, 'SMB5', 'zp'],
    [0xda, 'PHX', 's'],
    [0xdb, 'STP', 'i'],
    [0xea, 'NOP', 'i'],
    [0xfa, 'PLX', 's'],
    [0xff, 'BBS7', 'zp,r'],
  ])('opcode %d is Table 5-2: %s %s', (opcode, mnemonic, mode) => {
    expect(op(opcode)).toMatchObject({ mnemonic, mode, reserved: false });
  });

  it('gives each mode its bytes (Table 4-1); BRK is 2 bytes', () => {
    for (const info of W65C02S_OPCODES) {
      expect(info.bytes).toBe(info.opcode === 0x00 ? 2 : MODE_BYTES[info.mode]);
    }
    expect(op(0x00).bytes).toBe(2);
    expect(op(0x0f).bytes).toBe(3);
  });

  it('makes the reserved opcodes the NOPs of Table 7-1', () => {
    const reserved = W65C02S_OPCODES.filter((info) => info.reserved).map((info) => [
      info.opcode,
      info.bytes,
      info.cycles,
    ]);
    const expected: number[][] = [];
    for (let opcode = 0; opcode < 256; opcode++) {
      const low = opcode & 0x0f;
      if (low === 0x3 || (low === 0xb && opcode !== 0xcb && opcode !== 0xdb)) {
        expected.push([opcode, 1, 1]);
      } else if ([0x02, 0x22, 0x42, 0x62, 0x82, 0xc2, 0xe2].includes(opcode)) {
        expected.push([opcode, 2, 2]);
      } else if (opcode === 0x44) expected.push([opcode, 2, 3]);
      else if ([0x54, 0xd4, 0xf4].includes(opcode)) expected.push([opcode, 2, 4]);
      else if (opcode === 0x5c) expected.push([opcode, 3, 8]);
      else if (opcode === 0xdc || opcode === 0xfc) expected.push([opcode, 3, 4]);
    }
    expect(reserved).toEqual(expected);
    expect(W65C02S_OPCODES.filter((info) => info.reserved).every((i) => i.mnemonic === 'NOP')).toBe(
      true,
    );
  });

  it("times a read instruction by its mode (Table 4-1's W65C02S column)", () => {
    const lda: Record<string, number> = {};
    for (const info of W65C02S_OPCODES) {
      if (info.mnemonic === 'LDA') lda[info.mode] = info.cycles;
    }
    expect(lda).toEqual({
      a: 4,
      'a,x': 4,
      'a,y': 4,
      '#': 2,
      zp: 3,
      '(zp,x)': 6,
      'zp,x': 4,
      '(zp)': 5,
      '(zp),y': 5,
    });
    expect(op(0xb6).cycles).toBe(4); // LDX zp,y
  });

  it('times the rest as Table 4-1 and the notes give them', () => {
    expect(op(0x6c).cycles).toBe(6); // JMP (a): one more than the NMOS 6502 (Table 7-1)
    expect(op(0x7c).cycles).toBe(6); // JMP (a,x)
    expect(op(0x4c).cycles).toBe(3);
    expect(op(0x0e).cycles).toBe(6); // ASL a: read-modify-write adds 2
    expect(op(0x1e).cycles).toBe(6); // ASL a,x in the same page: six (Table 7-1)
    expect(op(0x0a).cycles).toBe(2); // ASL A
    expect(op(0xf0).cycles).toBe(2); // BEQ not taken
    expect(op(0x9d).cycles).toBe(5); // STA a,x: always the extra cycle (Table 4-1 note 1)
    const stack = W65C02S_OPCODES.filter((info) => info.mode === 's').map((info) => info.cycles);
    expect(Math.min(...stack)).toBe(3);
    expect(Math.max(...stack)).toBe(7); // Table 4-1: stack 3–7
  });
});
