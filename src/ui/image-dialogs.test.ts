import { describe, expect, it } from 'vitest';
import { functionScriptHost, runBench } from '../circuit';
import { benchTestDocument } from '../circuit/bench/test-circuits';
import { benchTestRegistry } from '../circuit/bench/test-parts';
import {
  benchImageCall,
  circuitMemories,
  describeImage,
  type ImageFileInfo,
  imageFileBytes,
  imageFileName,
  readImageForLoad,
} from './image-dialogs';

const ascii = (text: string) => new TextEncoder().encode(text);

describe('loading a file', () => {
  it('reads a binary file and describes it as a programmer does', () => {
    const info = readImageForLoad('rom.bin', new Uint8Array([1, 2, 0xff]));
    expect(info).toMatchObject({ name: 'rom.bin', format: 'binary' });
    expect(describeImage((info as ImageFileInfo).summary)).toBe(
      '0x0000–0x0002 · 3 bytes · sum 0x0102',
    );
  });

  it('reads Intel HEX, even under another extension', () => {
    const info = readImageForLoad('prog.txt', ascii(':03001000010203E7\n:00000001FF\n'));
    expect(info).toMatchObject({ format: 'intel-hex' });
    expect(describeImage((info as ImageFileInfo).summary)).toBe(
      '0x0010–0x0012 · 3 bytes · sum 0x0006',
    );
  });

  it('says why a file can’t be loaded', () => {
    expect(readImageForLoad('bad.hex', ascii(':0100000042BE\n:00000001FF'))).toBe(
      'bad.hex: line 1: checksum 0xBE, expected 0xBD',
    );
    expect(readImageForLoad('empty.bin', new Uint8Array())).toBe('empty.bin: the file is empty');
  });
});

describe('saving a file', () => {
  const bytes = new Uint8Array(32).fill(0xff);
  bytes[0x11] = 0x42;

  it('writes the bytes as they are, or Intel HEX text', () => {
    expect([...imageFileBytes(bytes, { kind: 'binary', base: 0, omitErased: true })]).toEqual([
      ...bytes,
    ]);
    const hex = new TextDecoder().decode(
      imageFileBytes(bytes, { kind: 'intel-hex', base: 0x8000, omitErased: true }),
    );
    expect(hex).toBe(`:10801000FF42${'FF'.repeat(14)}2D\n:00000001FF\n`);
  });

  it('names the file after the memory', () => {
    expect([imageFileName('U3', 'binary'), imageFileName('U3', 'intel-hex')]).toEqual([
      'U3.bin',
      'U3.hex',
    ]);
  });
});

describe('Insert Image… in a test script', () => {
  const registry = benchTestRegistry();
  const host = functionScriptHost();
  const text = (s: string) => new TextEncoder().encode(s);

  /** Runs `call` in a bench of the bench tests' `memory` circuit (a 16-word RAM, U1). */
  function runIn(call: string, check: string) {
    const document = benchTestDocument();
    const script = `bench('loaded', (b) => {\n${call}\n${check}\n});`;
    const withScript = {
      ...document,
      circuits: document.circuits.map((c) =>
        c.id === 'memory' ? { ...c, testScript: script.split('\n') } : c,
      ),
    };
    return runBench(withScript, 'memory', 'loaded', registry, host);
  }

  it('lists the circuit’s memory parts', () => {
    const memory = benchTestDocument().circuits.find((c) => c.id === 'memory')!;
    expect(circuitMemories(memory, registry)).toEqual([
      { id: 'U1', name: 'RAM', words: 16, volatile: true },
    ]);
  });

  it('writes a binary image as b.memory, sixteen bytes a line, that loads in a bench', () => {
    const bytes = Uint8Array.from({ length: 18 }, (_, i) => (i * 7) & 0xff);
    const info = readImageForLoad('program.bin', bytes) as ImageFileInfo;
    const call = benchImageCall('U1', info, bytes, 0);
    expect(call).toBe(
      [
        "b.memory('U1', 0x0000, `",
        '  00 07 0E 15 1C 23 2A 31 38 3F 46 4D 54 5B 62 69',
        '  70 77',
        '`); // program.bin: 0x0000–0x0011 · 18 bytes · sum 0x042F',
      ].join('\n'),
    );
    // 18 bytes don't fit a 16-word RAM: the bench says so.
    expect(runIn(call, '').error?.message).toMatch(/U1/);
    const fits = readImageForLoad('small.bin', bytes.slice(0, 3)) as ImageFileInfo;
    const result = runIn(
      benchImageCall('U1', fits, bytes.slice(0, 3), 2),
      "b.expect({ 'U1[2]': 0x00, 'U1[3]': 0x07, 'U1[4]': 0x0E });",
    );
    expect([result.status, result.failures]).toEqual(['pass', []]);
  });

  it('writes an Intel HEX file as b.loadIntelHex with its records, that loads in a bench', () => {
    const hex = ':0300020011223395\r\n:00000001FF\r\n';
    const info = readImageForLoad('decoder.hex', text(hex)) as ImageFileInfo;
    const call = benchImageCall("A1/U'1", info, text(hex), 0);
    expect(call).toBe(
      [
        "b.loadIntelHex('A1/U\\'1', `",
        '  :0300020011223395',
        '  :00000001FF',
        '`); // decoder.hex: 0x0002–0x0004 · 3 bytes · sum 0x0066',
      ].join('\n'),
    );
    const result = runIn(
      benchImageCall('U1', info, text(hex), 0),
      "b.expect({ 'U1[2]': 0x11, 'U1[3]': 0x22, 'U1[4]': 0x33 });",
    );
    expect([result.status, result.failures]).toEqual(['pass', []]);
  });
});
