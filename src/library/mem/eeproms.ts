/**
 * Parallel EEPROMs (AT28C16, AT28C64B, AT28C256) from the Atmel/Microchip data sheets, read as
 * ROMs: the contents come from the `contents` image prop (erased bytes 0xFF); a write the
 * circuit attempts is reported and ignored (EEPROM write cycles are backlog, R12a Q5).
 * Spec: docs/components.md#memories-mem.
 */
import {
  type AnyComponentDefinition,
  defineComponent,
  type FunctionTable,
  Level,
  ns,
  parseImage,
  type Time,
  type TimingDef,
  toInput,
} from '../../core';
import { dipPins, type PinRow, pins } from '../74xx/pinout';
import {
  addressPinNames,
  createMemoryState,
  enabledByLow,
  MemoryDiagnosticKind,
  type MemoryState,
  memoryPins,
  ReadPath,
  type ReadTiming,
  withDataLabels,
} from './memory';

/** One EEPROM as its data sheet describes it. */
interface EepromSpec {
  readonly name: string;
  readonly title: string;
  readonly words: number;
  readonly pinCount: number;
  readonly pins: readonly PinRow[];
  readonly datasheet: string;
  readonly timing: TimingDef;
}

const dataPins = (numbers: string) =>
  pins('IO0, IO1, IO2, IO3, IO4, IO5, IO6, IO7', numbers, 'bidir', 'data input/output');

/** The controls every EEPROM here has, at their pin numbers. */
const controls = (ce: number, oe: number, we: number): PinRow[] => [
  pins('CE', `${ce}`, 'in', 'chip enable (active LOW)', { activeLow: true }),
  pins('OE', `${oe}`, 'in', 'output enable (active LOW)', { activeLow: true }),
  pins('WE', `${we}`, 'in', 'write enable (active LOW)', { activeLow: true }),
];

const ns_ = (values: Record<string, number>): Record<string, Time> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, ns(v)]));

const CONDITIONS = 'VCC = 5 V ± 10%, CL = 100 pF (5 pF for tDF); limits only, no typical values';

/** The read limits of an EEPROM's `-15` grade (150 ns), the only one sold outside military. */
const readTiming = (oeMin: number, source: string): TimingDef => ({
  typical: {},
  max: ns_({ tACC: 150, tCE: 150, tOE: 70, tDF: 50 }),
  min: ns_({ tOE: oeMin, tDF: 0, tOH: 0 }),
  conditions: CONDITIONS,
  source,
});

const MICROCHIP = 'https://ww1.microchip.com/downloads/en/DeviceDoc';

export const AT28C16: EepromSpec = {
  name: 'AT28C16',
  title: '16K (2K × 8) parallel EEPROM',
  words: 2048,
  pinCount: 24,
  pins: [
    pins('A7, A6, A5, A4, A3, A2, A1, A0', '1, 2, 3, 4, 5, 6, 7, 8', 'in', 'address input'),
    pins('A8, A9, A10', '23, 22, 19', 'in', 'address input'),
    dataPins('9, 10, 11, 13, 14, 15, 16, 17'),
    pins('GND', '12', 'power', 'ground (0 V)'),
    ...controls(18, 20, 21),
    pins('VCC', '24', 'power', 'supply voltage'),
  ],
  datasheet: `${MICROCHIP}/doc0540.pdf`,
  timing: readTiming(10, 'Atmel AT28C16 data sheet, rev. 0540B–10/98, AC read characteristics'),
};

export const AT28C64B: EepromSpec = {
  name: 'AT28C64B',
  title: '64K (8K × 8) parallel EEPROM',
  words: 8192,
  pinCount: 28,
  pins: [
    pins('n.c.', '1, 26', 'nc', 'no connect'),
    pins(
      'A12, A7, A6, A5, A4, A3, A2, A1, A0',
      '2, 3, 4, 5, 6, 7, 8, 9, 10',
      'in',
      'address input',
    ),
    pins('A8, A9, A10, A11', '25, 24, 21, 23', 'in', 'address input'),
    dataPins('11, 12, 13, 15, 16, 17, 18, 19'),
    pins('GND', '14', 'power', 'ground (0 V)'),
    ...controls(20, 22, 27),
    pins('VCC', '28', 'power', 'supply voltage'),
  ],
  datasheet: `${MICROCHIP}/doc0270.pdf`,
  timing: readTiming(
    0,
    'Atmel AT28C64B data sheet, rev. 0270L–PEEPR–2/09, section 9 (AC read characteristics)',
  ),
};

export const AT28C256: EepromSpec = {
  name: 'AT28C256',
  title: '256K (32K × 8) paged parallel EEPROM',
  words: 32768,
  pinCount: 28,
  pins: [
    pins(
      'A14, A12, A7, A6, A5, A4, A3, A2, A1, A0',
      '1, 2, 3, 4, 5, 6, 7, 8, 9, 10',
      'in',
      'address input',
    ),
    pins('A8, A9, A10, A11, A13', '25, 24, 21, 23, 26', 'in', 'address input'),
    dataPins('11, 12, 13, 15, 16, 17, 18, 19'),
    pins('GND', '14', 'power', 'ground (0 V)'),
    ...controls(20, 22, 27),
    pins('VCC', '28', 'power', 'supply voltage'),
  ],
  datasheet: `${MICROCHIP}/doc0006.pdf`,
  timing: readTiming(
    0,
    'Atmel AT28C256 data sheet, rev. 0006M–PEEPR–12/09, section 9 (AC read characteristics, AT28C256-15)',
  ),
};

/** The data sheets' operating modes (chip erase, with OE̅ at 12 V, is not modeled). */
export const EEPROM_MODES: FunctionTable = {
  inputs: ['CE', 'OE', 'WE'],
  outputs: ['IOn'],
  rows: ['L L H | Dout', 'L H L | Din', 'H X X | Z', 'X H X | Z'],
  note: 'read, write (not simulated: reported and ignored), standby, output disable',
};

/** The read path's limits from an EEPROM's timing (no low-Z times given: 0). */
function eepromReadTiming(timing: TimingDef): ReadTiming {
  const max = timing.max ?? {};
  const min = timing.min ?? {};
  const need = (table: Readonly<Record<string, Time>>, key: string) => {
    const value = table[key];
    if (value === undefined) throw new Error(`missing timing "${key}"`);
    return value;
  };
  const release = need(max, 'tDF');
  return {
    access: need(max, 'tACC'),
    ceAccess: need(max, 'tCE'),
    oeAccess: need(max, 'tOE'),
    hold: need(min, 'tOH'),
    ceLowZ: 0,
    oeLowZ: 0,
    ceRelease: release,
    oeRelease: release,
    weLowZ: 0,
    weRelease: 0,
  };
}

type EepromProps = { contents: string };

function eepromDefinition(spec: EepromSpec): AnyComponentDefinition {
  const pinList = withDataLabels(dipPins(spec.pinCount, spec.pins));
  const memoryPinRefs = memoryPins(pinList, Math.log2(spec.words), 'CE');
  const timing = eepromReadTiming(spec.timing);
  const read = new ReadPath(memoryPinRefs, timing, false);
  const { ce: CE, oe: OE, we: WE } = memoryPinRefs;

  return defineComponent<EepromProps, MemoryState>({
    type: `mem/${spec.name.toLowerCase()}`,
    name: spec.name,
    title: spec.title,
    keywords: ['eeprom', 'rom', 'memory'],
    datasheet: spec.datasheet,
    pins: pinList,
    package: { kind: 'dip', pins: spec.pinCount },
    props: [{ key: 'contents', label: 'Contents', type: 'image', default: '', max: spec.words }],
    timing: spec.timing,
    functionTable: EEPROM_MODES,
    memory: {
      words: spec.words,
      width: 8,
      volatile: false,
      addressPins: addressPinNames(Math.log2(spec.words)),
      view: (state) => state,
    },
    create: ({ contents }) => {
      const image = parseImage(contents, spec.words);
      return {
        createState: () => {
          const state = createMemoryState(spec.words);
          state.data.set(image);
          return state;
        },
        evaluate(ctx) {
          const ce = toInput(ctx.read(CE));
          const oe = toInput(ctx.read(OE));
          const we = toInput(ctx.read(WE));
          const addressChanged = read.track(ctx, ce, oe, we);
          // The data sheet's byte write: WE̅ (or CE̅) falling while the other is LOW and OE̅ HIGH.
          if (
            ce === Level.L0 &&
            we === Level.L0 &&
            oe === Level.L1 &&
            ((ctx.changed(WE) && ctx.prev(WE) !== Level.L0) ||
              (ctx.changed(CE) && ctx.prev(CE) !== Level.L0))
          ) {
            ctx.report({
              kind: MemoryDiagnosticKind.WRITE_IGNORED,
              message: `EEPROM writes are not simulated: the write to ${read.addressText(ctx)} was ignored`,
              pin: ctx.changed(WE) ? WE : CE,
            });
          }
          // Released after the release time of the control that turned the outputs off.
          const release = Math.max(
            ctx.changed(CE) && ce === Level.L1 ? timing.ceRelease : 0,
            ctx.changed(OE) && oe === Level.L1 ? timing.oeRelease : 0,
          );
          read.update(ctx, enabledByLow(ce, oe), addressChanged, release);
        },
        wake(ctx, token) {
          read.wake(ctx, token);
        },
      };
    },
  });
}

export const eeproms: readonly AnyComponentDefinition[] = [AT28C16, AT28C64B, AT28C256].map(
  eepromDefinition,
);
