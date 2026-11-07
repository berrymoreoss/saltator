/**
 * Static RAMs (6116, 62256) from their data sheets: the shared read path with its `X` window,
 * level-sensitive writes checked against the data sheet's requirements (`write.ts`), power-on
 * contents unknown (default), zeroed or random, and the `poke` debug write.
 * Spec: docs/components.md#memories-mem.
 */
import {
  type AnyComponentDefinition,
  defineComponent,
  type EvalContext,
  type FunctionTable,
  hashString,
  isPokeAction,
  Level,
  not,
  ns,
  type PropDef,
  SeededRandom,
  type Time,
  type TimingDef,
  toInput,
} from '../../core';
import { dipPins, type PinRow, pins } from '../74xx/pinout';
import {
  createMemoryState,
  enabledByLow,
  memoryPins,
  ReadPath,
  type ReadTiming,
  T_ADDRESS,
  withDataLabels,
} from './memory';
import { createRamState, type RamState, WritePath, type WriteTiming } from './write';

/** One SRAM as its data sheet describes it; `grades` are its speed grades' timing. */
export interface SramSpec {
  readonly name: string;
  readonly title: string;
  readonly words: number;
  readonly pinCount: number;
  readonly pins: readonly PinRow[];
  readonly datasheet: string;
  /** Speed grades by their access time in ns (`'25'`), each with its label. */
  readonly grades: Readonly<Record<string, { readonly label: string; readonly timing: TimingDef }>>;
  readonly defaultGrade: string;
}

/** `{ tAA: 15 }` in ns → ps. */
const nsAll = (values: Record<string, number>): Record<string, Time> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, ns(v)]));

const dataPins = (numbers: string) =>
  pins('IO0, IO1, IO2, IO3, IO4, IO5, IO6, IO7', numbers, 'bidir', 'data input/output');

const IDT_6116 =
  'Renesas (IDT) 6116SA/LA data sheet, Jul.17.20, AC electrical characteristics (read and write cycles)';
const CONDITIONS_6116 =
  'VCC = 5 V ± 10%, CL = 30 pF (tCLZ, tOLZ, tCHZ, tOHZ, tWHZ, tOW at 5 pF), over the operating ' +
  'temperature range; the data sheet gives limits only, no typical values';

/** One 6116SA/LA speed grade: read limits (max), output and write minima, from the tables. */
function grade6116(
  read: { tAA: number; tACS: number; tOE: number; tCHZ: number; tOHZ: number; tWHZ: number },
  min: { tCLZ: number; tOLZ: number; tCW: number; tAW: number; tWP: number; tDW: number },
): TimingDef {
  return {
    typical: {},
    max: nsAll(read),
    min: nsAll({ ...min, tOH: 5, tAS: 0, tWR: 0, tDH: 0, tOW: 0 }),
    conditions: CONDITIONS_6116,
    source: IDT_6116,
  };
}

export const SRAM_6116: SramSpec = {
  name: '6116',
  title: '16K (2K × 8) CMOS static RAM',
  words: 2048,
  pinCount: 24,
  pins: [
    pins('A7, A6, A5, A4, A3, A2, A1, A0', '1, 2, 3, 4, 5, 6, 7, 8', 'in', 'address input'),
    pins('A8, A9, A10', '23, 22, 19', 'in', 'address input'),
    dataPins('9, 10, 11, 13, 14, 15, 16, 17'),
    pins('GND', '12', 'power', 'ground (0 V)'),
    pins('CS', '18', 'in', 'chip select (active LOW)', { activeLow: true }),
    pins('OE', '20', 'in', 'output enable (active LOW)', { activeLow: true }),
    pins('WE', '21', 'in', 'write enable (active LOW)', { activeLow: true }),
    pins('VCC', '24', 'power', 'supply voltage'),
  ],
  datasheet: 'https://www.renesas.com/us/en/document/dst/6116sala-data-sheet',
  grades: {
    '15': {
      label: '15 ns (6116SA15, 0–70 °C)',
      timing: grade6116(
        { tAA: 15, tACS: 15, tOE: 10, tCHZ: 10, tOHZ: 8, tWHZ: 7 },
        { tCLZ: 5, tOLZ: 0, tCW: 13, tAW: 14, tWP: 12, tDW: 12 },
      ),
    },
    '20': {
      label: '20 ns (6116SA20, LA20)',
      timing: grade6116(
        { tAA: 19, tACS: 20, tOE: 10, tCHZ: 11, tOHZ: 8, tWHZ: 8 },
        { tCLZ: 5, tOLZ: 0, tCW: 15, tAW: 15, tWP: 12, tDW: 12 },
      ),
    },
    '25': {
      label: '25 ns (6116SA25, LA25)',
      timing: grade6116(
        { tAA: 25, tACS: 25, tOE: 13, tCHZ: 12, tOHZ: 10, tWHZ: 16 },
        { tCLZ: 5, tOLZ: 5, tCW: 17, tAW: 17, tWP: 15, tDW: 13 },
      ),
    },
  },
  defaultGrade: '25',
};

/** The data sheets' truth table. */
export const SRAM_MODES: FunctionTable = {
  inputs: ['CS', 'OE', 'WE'],
  outputs: ['IOn'],
  rows: ['H X X | Z', 'L L H | Dout', 'L H H | Z', 'L X L | Din'],
  note: 'standby, read, read with the outputs disabled, write',
};

export const POWER_ON: PropDef = {
  key: 'powerOn',
  label: 'Power-on contents',
  type: 'enum',
  default: 'x',
  options: [
    { value: 'x', label: 'Unknown (X)' },
    { value: 'zeros', label: 'Zeros' },
    { value: 'random', label: 'Random' },
  ],
};

function need(table: Readonly<Record<string, Time>> | undefined, key: string): Time {
  const value = table?.[key];
  if (value === undefined) throw new Error(`missing timing "${key}"`);
  return value;
}

function sramReadTiming({ max, min }: TimingDef): ReadTiming {
  return {
    access: need(max, 'tAA'),
    ceAccess: need(max, 'tACS'),
    oeAccess: need(max, 'tOE'),
    hold: need(min, 'tOH'),
    ceLowZ: need(min, 'tCLZ'),
    oeLowZ: need(min, 'tOLZ'),
    ceRelease: need(max, 'tCHZ'),
    oeRelease: need(max, 'tOHZ'),
    weLowZ: need(min, 'tOW'),
    weRelease: need(max, 'tWHZ'),
  };
}

function sramWriteTiming({ min }: TimingDef): WriteTiming {
  return {
    addressSetup: need(min, 'tAS'),
    addressValid: need(min, 'tAW'),
    pulse: need(min, 'tWP'),
    chipSelect: need(min, 'tCW'),
    dataSetup: need(min, 'tDW'),
    dataHold: need(min, 'tDH'),
    recovery: need(min, 'tWR'),
  };
}

type SramProps = { speed: string; powerOn: string };

/** The definition of an SRAM: type `mem/<name>`, a DIP package, a speed prop for several grades. */
export function sramDefinition(spec: SramSpec): AnyComponentDefinition {
  const pinList = withDataLabels(dipPins(spec.pinCount, spec.pins));
  const refs = memoryPins(pinList, Math.log2(spec.words), 'CS');
  const { ce: CS, oe: OE, we: WE } = refs;
  const grades = Object.keys(spec.grades);
  const timingOf = (speed: string) =>
    (spec.grades[speed] ?? spec.grades[spec.defaultGrade]!).timing;

  const props: PropDef[] = [POWER_ON];
  if (grades.length > 1) {
    props.unshift({
      key: 'speed',
      label: 'Speed',
      type: 'enum',
      default: spec.defaultGrade,
      options: grades.map((value) => ({ value, label: spec.grades[value]!.label })),
    });
  }

  return defineComponent<SramProps, RamState>({
    type: `mem/${spec.name.toLowerCase()}`,
    name: spec.name,
    title: spec.title,
    keywords: ['sram', 'ram', 'memory'],
    datasheet: spec.datasheet,
    pins: pinList,
    package: { kind: 'dip', pins: spec.pinCount },
    props,
    timing: grades.length > 1 ? ({ speed }) => timingOf(speed) : timingOf(spec.defaultGrade),
    functionTable: SRAM_MODES,
    memory: { words: spec.words, width: 8, volatile: true, view: (state) => state },
    create: ({ speed, powerOn }) => {
      const timing = timingOf(speed ?? spec.defaultGrade);
      const readTiming = sramReadTiming(timing);
      const read = new ReadPath(refs, readTiming, true);
      const write = new WritePath(refs, pinList, sramWriteTiming(timing));
      const outputsOn = (cs: Level, oe: Level, we: Level) => enabledByLow(cs, oe, not(we));

      return {
        createState: () => {
          const state = createRamState(createMemoryState(spec.words), 8);
          if (powerOn === 'x') state.unknown.fill(0xff);
          return state;
        },
        init(ctx) {
          if (powerOn === 'random') new SeededRandom(hashString(ctx.id)).fill(ctx.state.data);
        },
        evaluate(ctx) {
          const cs = toInput(ctx.read(CS));
          const oe = toInput(ctx.read(OE));
          const we = toInput(ctx.read(WE));
          write.evaluate(ctx, cs, we);
          const addressChanged = read.track(ctx, cs, oe, we);
          // Released after the release time of what turned the outputs off.
          const release = Math.max(
            ctx.changed(CS) && cs === Level.L1 ? readTiming.ceRelease : 0,
            ctx.changed(OE) && oe === Level.L1 ? readTiming.oeRelease : 0,
            ctx.changed(WE) && we === Level.L0 ? readTiming.weRelease : 0,
          );
          read.update(ctx, outputsOn(cs, oe, we), addressChanged, release);
        },
        wake(ctx, token) {
          read.wake(ctx, token);
        },
        action(ctx, payload) {
          if (!isPokeAction(payload)) {
            throw new Error(`${ctx.id}: unknown action ${JSON.stringify(payload)}`);
          }
          poke(ctx, payload.address, payload.data, spec.words);
          // Outputs reading the cells follow as after an address change: X, then the data.
          const on = outputsOn(toInput(ctx.read(CS)), toInput(ctx.read(OE)), toInput(ctx.read(WE)));
          if (on !== Level.L0) {
            ctx.state.times[T_ADDRESS] = ctx.now;
            read.update(ctx, on, true, 0);
          }
        },
      };
    },
  });
}

/** Writes `bytes` from `address` on, known, bypassing timing. */
function poke(
  ctx: EvalContext<RamState>,
  address: number,
  bytes: readonly number[],
  words: number,
): void {
  if (address < 0 || address + bytes.length > words) {
    throw new Error(
      `${ctx.id}: poke of ${bytes.length} bytes at ${address} is outside 0…${words - 1}`,
    );
  }
  const { data, unknown } = ctx.state;
  for (let i = 0; i < bytes.length; i++) {
    data[address + i] = bytes[i]! & 0xff;
    unknown[address + i] = 0;
  }
}

export const srams: readonly AnyComponentDefinition[] = [SRAM_6116].map(sramDefinition);
