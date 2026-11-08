/**
 * The W65C02S's 256 opcodes: mnemonic, addressing mode, bytes and base cycles. Data only — the
 * core (`w65c02s-core.ts`) executes them, R17b's disassembler and R19's assembler read them.
 * Source: WDC W65C02S data sheet (April 8, 2022): Table 5-2 (opcode matrix), Table 4-1
 * (addressing modes, bytes, cycles), Table 7-1 (reserved opcodes).
 */

/**
 * Addressing modes by the data sheet's symbols (Table 4-1), plus `zp,r`: `BBR`/`BBS` take a
 * zero-page address and a branch displacement (3 bytes); Table 5-2 marks them `r`.
 */
export type AddressingMode =
  | 'a'
  | '(a,x)'
  | 'a,x'
  | 'a,y'
  | '(a)'
  | 'A'
  | '#'
  | 'i'
  | 'r'
  | 's'
  | 'zp'
  | '(zp,x)'
  | 'zp,x'
  | 'zp,y'
  | '(zp)'
  | '(zp),y'
  | 'zp,r';

/** Bytes of an instruction in each mode (Table 4-1; `BRK` is the exception: 2). */
export const MODE_BYTES: Readonly<Record<AddressingMode, number>> = {
  a: 3,
  '(a,x)': 3,
  'a,x': 3,
  'a,y': 3,
  '(a)': 3,
  A: 1,
  '#': 2,
  i: 1,
  r: 2,
  s: 1,
  zp: 2,
  '(zp,x)': 2,
  'zp,x': 2,
  'zp,y': 2,
  '(zp)': 2,
  '(zp),y': 2,
  'zp,r': 3,
};

export interface OpcodeInfo {
  readonly opcode: number;
  /** As Table 5-2 writes it: `LDA`, `RMB3`, `BBS7`; `NOP` for the reserved opcodes. */
  readonly mnemonic: string;
  readonly mode: AddressingMode;
  readonly bytes: number;
  /**
   * Cycles without the extras Table 4-1 lists: a page crossed when indexing, a branch taken,
   * decimal mode (`ADC`, `SBC`).
   */
  readonly cycles: number;
  /** Not an instruction: Table 7-1's NOPs "reserved for future use". */
  readonly reserved: boolean;
}

/**
 * Table 5-2, row by row (most significant digit 0–F), one cell per least significant digit:
 * `mnemonic mode`, empty for a reserved opcode.
 */
const MATRIX: readonly string[] = [
  'BRK s|ORA (zp,x)|||TSB zp|ORA zp|ASL zp|RMB0 zp|PHP s|ORA #|ASL A||TSB a|ORA a|ASL a|BBR0 r',
  'BPL r|ORA (zp),y|ORA (zp)||TRB zp|ORA zp,x|ASL zp,x|RMB1 zp|CLC i|ORA a,y|INC A||TRB a|ORA a,x|ASL a,x|BBR1 r',
  'JSR a|AND (zp,x)|||BIT zp|AND zp|ROL zp|RMB2 zp|PLP s|AND #|ROL A||BIT a|AND a|ROL a|BBR2 r',
  'BMI r|AND (zp),y|AND (zp)||BIT zp,x|AND zp,x|ROL zp,x|RMB3 zp|SEC i|AND a,y|DEC A||BIT a,x|AND a,x|ROL a,x|BBR3 r',
  'RTI s|EOR (zp,x)||||EOR zp|LSR zp|RMB4 zp|PHA s|EOR #|LSR A||JMP a|EOR a|LSR a|BBR4 r',
  'BVC r|EOR (zp),y|EOR (zp)|||EOR zp,x|LSR zp,x|RMB5 zp|CLI i|EOR a,y|PHY s|||EOR a,x|LSR a,x|BBR5 r',
  'RTS s|ADC (zp,x)|||STZ zp|ADC zp|ROR zp|RMB6 zp|PLA s|ADC #|ROR A||JMP (a)|ADC a|ROR a|BBR6 r',
  'BVS r|ADC (zp),y|ADC (zp)||STZ zp,x|ADC zp,x|ROR zp,x|RMB7 zp|SEI i|ADC a,y|PLY s||JMP (a,x)|ADC a,x|ROR a,x|BBR7 r',
  'BRA r|STA (zp,x)|||STY zp|STA zp|STX zp|SMB0 zp|DEY i|BIT #|TXA i||STY a|STA a|STX a|BBS0 r',
  'BCC r|STA (zp),y|STA (zp)||STY zp,x|STA zp,x|STX zp,y|SMB1 zp|TYA i|STA a,y|TXS i||STZ a|STA a,x|STZ a,x|BBS1 r',
  'LDY #|LDA (zp,x)|LDX #||LDY zp|LDA zp|LDX zp|SMB2 zp|TAY i|LDA #|TAX i||LDY a|LDA a|LDX a|BBS2 r',
  'BCS r|LDA (zp),y|LDA (zp)||LDY zp,x|LDA zp,x|LDX zp,y|SMB3 zp|CLV i|LDA a,y|TSX i||LDY a,x|LDA a,x|LDX a,y|BBS3 r',
  'CPY #|CMP (zp,x)|||CPY zp|CMP zp|DEC zp|SMB4 zp|INY i|CMP #|DEX i|WAI i|CPY a|CMP a|DEC a|BBS4 r',
  'BNE r|CMP (zp),y|CMP (zp)|||CMP zp,x|DEC zp,x|SMB5 zp|CLD i|CMP a,y|PHX s|STP i||CMP a,x|DEC a,x|BBS5 r',
  'CPX #|SBC (zp,x)|||CPX zp|SBC zp|INC zp|SMB6 zp|INX i|SBC #|NOP i||CPX a|SBC a|INC a|BBS6 r',
  'BEQ r|SBC (zp),y|SBC (zp)|||SBC zp,x|INC zp,x|SMB7 zp|SED i|SBC a,y|PLX s|||SBC a,x|INC a,x|BBS7 r',
];

/**
 * Table 7-1: every reserved opcode is a NOP of these bytes and cycles; the mode says how its
 * operand is read (`02`: like an immediate, `44`: a zero-page read, `5C`: an absolute one).
 */
const RESERVED: readonly (readonly [readonly number[], AddressingMode, number])[] = [
  [[0x02, 0x22, 0x42, 0x62, 0x82, 0xc2, 0xe2], '#', 2],
  [[0x44], 'zp', 3],
  [[0x54, 0xd4, 0xf4], 'zp,x', 4],
  [[0x5c], 'a', 8],
  [[0xdc, 0xfc], 'a', 4],
];

/** One-byte, one-cycle NOPs: `x3`, and `xB` but `CB` (`WAI`) and `DB` (`STP`). */
function oneCycleNop(opcode: number): boolean {
  const low = opcode & 0x0f;
  return low === 0x3 || (low === 0xb && opcode !== 0xcb && opcode !== 0xdb);
}

/** Read instructions: their cycles follow the addressing mode (Table 4-1). */
const READ_CYCLES: Partial<Record<AddressingMode, number>> = {
  '#': 2,
  zp: 3,
  'zp,x': 4,
  'zp,y': 4,
  a: 4,
  'a,x': 4,
  'a,y': 4,
  '(zp,x)': 6,
  '(zp)': 5,
  '(zp),y': 5,
};

/** Stores write without reading first, so indexing always takes its extra cycle. */
const STORE_CYCLES: Partial<Record<AddressingMode, number>> = {
  zp: 3,
  'zp,x': 4,
  'zp,y': 4,
  a: 4,
  'a,x': 5,
  'a,y': 5,
  '(zp,x)': 6,
  '(zp)': 5,
  '(zp),y': 6,
};

/** Read-modify-write: two reads and a write (Table 7-1); `a,x` in the same page takes six. */
const RMW_CYCLES: Partial<Record<AddressingMode, number>> = {
  A: 2,
  zp: 5,
  'zp,x': 6,
  a: 6,
  'a,x': 6,
};

const READS = new Set([
  'ADC',
  'AND',
  'BIT',
  'CMP',
  'CPX',
  'CPY',
  'EOR',
  'LDA',
  'LDX',
  'LDY',
  'ORA',
  'SBC',
]);
const STORES = new Set(['STA', 'STX', 'STY', 'STZ']);
const RMW = new Set(['ASL', 'DEC', 'INC', 'LSR', 'ROL', 'ROR', 'TRB', 'TSB']);

/** Cycles of the instructions whose timing isn't their mode's. */
const OWN_CYCLES: Readonly<Record<string, number>> = {
  BRK: 7,
  RTI: 6,
  RTS: 6,
  JSR: 6,
  PHA: 3,
  PHP: 3,
  PHX: 3,
  PHY: 3,
  PLA: 4,
  PLP: 4,
  PLX: 4,
  PLY: 4,
  WAI: 3,
  STP: 3,
  BRA: 3,
};

function baseCycles(mnemonic: string, mode: AddressingMode): number {
  const own = OWN_CYCLES[mnemonic];
  if (own !== undefined) return own;
  const operation = mnemonic.replace(/\d$/, '');
  if (operation === 'RMB' || operation === 'SMB') return 5;
  if (operation === 'BBR' || operation === 'BBS') return 5;
  if (mnemonic === 'JMP') return mode === 'a' ? 3 : 6;
  const table = READS.has(mnemonic)
    ? READ_CYCLES
    : STORES.has(mnemonic)
      ? STORE_CYCLES
      : RMW.has(mnemonic)
        ? RMW_CYCLES
        : undefined;
  if (table) {
    const cycles = table[mode];
    if (cycles === undefined) throw new Error(`no cycles for ${mnemonic} ${mode}`);
    return cycles;
  }
  // Implied and relative: two cycles (a branch taken adds one, a page crossed another).
  return 2;
}

function buildTable(): OpcodeInfo[] {
  const table: OpcodeInfo[] = [];
  for (let opcode = 0; opcode < 256; opcode++) {
    const cell = MATRIX[opcode >> 4]?.split('|')[opcode & 0x0f] ?? '';
    if (cell === '') {
      table.push(reservedInfo(opcode));
      continue;
    }
    const [mnemonic = '', symbol = ''] = cell.split(' ');
    const operation = mnemonic.replace(/\d$/, '');
    const mode: AddressingMode =
      operation === 'BBR' || operation === 'BBS' ? 'zp,r' : (symbol as AddressingMode);
    const bytes = mnemonic === 'BRK' ? 2 : MODE_BYTES[mode];
    table.push({
      opcode,
      mnemonic,
      mode,
      bytes,
      cycles: baseCycles(mnemonic, mode),
      reserved: false,
    });
  }
  return table;
}

function reservedInfo(opcode: number): OpcodeInfo {
  if (oneCycleNop(opcode)) {
    return { opcode, mnemonic: 'NOP', mode: 'i', bytes: 1, cycles: 1, reserved: true };
  }
  for (const [opcodes, mode, cycles] of RESERVED) {
    if (opcodes.includes(opcode)) {
      return { opcode, mnemonic: 'NOP', mode, bytes: MODE_BYTES[mode], cycles, reserved: true };
    }
  }
  throw new Error(`opcode ${opcode.toString(16)} is neither in Table 5-2 nor in Table 7-1`);
}

/** Every opcode, indexed by its value. */
export const W65C02S_OPCODES: readonly OpcodeInfo[] = buildTable();
