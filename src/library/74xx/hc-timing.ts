/**
 * 74HC timing from the Nexperia product data sheets (74HC; 74HCT), the "Dynamic characteristics"
 * table of each (table 7 unless noted); TI data sheets for the chips Nexperia doesn't document
 * (147, 148, 283). Every delay at VCC = 4.5 V, CL = 50 pF: the only condition with typical
 * `ten`/`tdis` and the one the maxima are given at (docs/components.md#timing). Chips with several
 * delay paths key each one by the data sheet's wording: `tpd(An to Yn)`. Sequential chips add
 * their timing requirements (set-up, hold, pulse width, recovery): the guaranteed minimum in
 * `timing.min` for the timing checks, the typical value in `timing.typical`.
 */
import { ns, type TimingDef } from '../../core';
import type { ChipTiming, LogicFamily } from './chip';

const CONDITIONS = 'VCC = 4.5 V, CL = 50 pF; typ at 25 °C, max at −40 °C to +85 °C';

/** Datasheet symbol → [typical at 25 °C, max at −40 °C to +85 °C] in ns: a delay. */
type Delays = Readonly<Record<string, readonly [typ: number, max: number]>>;

/**
 * Datasheet symbol → [guaranteed min, typical at 25 °C] in ns: a timing requirement (`tsu`, `th`,
 * `tW`, `trec`), which the timing checks hold the circuit to. The typical value may be negative.
 */
type Requirements = Readonly<Record<string, readonly [min: number, typ: number]>>;

/** Where a data sheet's minima apply: 25 °C, or its widest range when it gives no 25 °C column. */
type MinAt = '25 °C' | '−40 °C to +85 °C';

function chipTiming(
  datasheet: string,
  source: string,
  delays: Delays,
  requirements: Requirements = {},
  minAt: MinAt = '25 °C',
): ChipTiming {
  const pick = (values: Delays | Requirements, i: 0 | 1) =>
    Object.fromEntries(Object.entries(values).map(([symbol, v]) => [symbol, ns(v[i])]));
  const checked = Object.keys(requirements).length > 0;
  const timing: TimingDef = {
    typical: { ...pick(delays, 0), ...pick(requirements, 1) },
    max: pick(delays, 1),
    ...(checked && { min: pick(requirements, 0) }),
    conditions: checked ? `${CONDITIONS}, min at ${minAt}` : CONDITIONS,
    source,
  };
  return { datasheet, timing };
}

function nexperia(
  document: string,
  revision: string,
  delays: Delays,
  more: { table?: number; requirements?: Requirements; minAt?: MinAt } = {},
): ChipTiming {
  return chipTiming(
    `https://assets.nexperia.com/documents/data-sheet/${document}.pdf`,
    `Nexperia ${document} product data sheet, ${revision}, table ${more.table ?? 7}`,
    delays,
    more.requirements,
    more.minAt,
  );
}

/**
 * A TI data sheet (`part` is its file name at ti.com). `typicalFrom` names the document the
 * typical values come from when TI gives none at 4.5 V / 50 pF (ex-Harris CD74HC sheets give
 * typical values only at 5 V / 15 pF); the maxima are TI's.
 */
function ti(
  part: string,
  document: string,
  section: string,
  delays: Delays,
  typicalFrom?: string,
): ChipTiming {
  const source = `TI ${part.toUpperCase()} data sheet, ${document}, ${section}`;
  return chipTiming(
    `https://www.ti.com/lit/ds/symlink/${part}.pdf`,
    typicalFrom ? `${source} (max); ${typicalFrom} (typ)` : source,
    delays,
  );
}

const PHILIPS_1990 = 'product specification (December 1990), AC characteristics for 74HC';

/** The 74HC family: high-speed CMOS, CMOS input levels. */
export const HC: LogicFamily = {
  name: 'HC',
  chips: {
    '00': nexperia('74HC_HCT00', 'rev. 11 (29 April 2025)', { tpd: [9, 23] }),
    '02': nexperia('74HC_HCT02', 'rev. 9 (15 February 2024)', { tpd: [9, 23] }),
    '04': nexperia('74HC_HCT04', 'rev. 10 (16 February 2024)', { tpd: [9, 21] }),
    '08': nexperia('74HC_HCT08', 'rev. 9 (16 February 2024)', { tpd: [9, 23] }),
    '10': nexperia('74HC_HCT10', 'rev. 5 (20 February 2024)', { tpd: [11, 24] }),
    '11': nexperia('74HC_HCT11', 'rev. 9 (21 February 2024)', { tpd: [12, 25] }),
    '14': nexperia('74HC_HCT14', 'rev. 10 (29 February 2024)', { tpd: [15, 31] }),
    '20': nexperia('74HC20', 'rev. 7 (14 March 2024)', { tpd: [10, 23] }),
    '21': nexperia('74HC21', 'rev. 10 (17 January 2024)', { tpd: [12, 28] }),
    '27': nexperia('74HC_HCT27', 'rev. 7 (25 March 2024)', { tpd: [10, 23] }),
    '30': nexperia('74HC_HCT30', 'rev. 10 (13 March 2024)', { tpd: [15, 33] }),
    '32': nexperia('74HC_HCT32', 'rev. 10 (30 April 2025)', { tpd: [8, 23] }),
    '86': nexperia('74HC_HCT86', 'rev. 7 (2 April 2024)', { tpd: [14, 30] }),
    '125': nexperia('74HC_HCT125', 'rev. 8 (22 February 2024)', {
      tpd: [11, 25],
      ten: [15, 31],
      tdis: [15, 31],
    }),
    '126': nexperia('74HC_HCT126', 'rev. 8 (30 July 2025)', {
      tpd: [11, 25],
      ten: [15, 31],
      tdis: [15, 31],
    }),
    '240': nexperia('74HC_HCT240', 'rev. 7 (5 August 2024)', {
      tpd: [11, 25],
      ten: [14, 38],
      tdis: [15, 38],
    }),
    '244': nexperia('74HC_HCT244', 'rev. 8 (5 August 2024)', {
      tpd: [11, 28],
      ten: [13, 38],
      tdis: [14, 38],
    }),
    '245': nexperia('74HC_HCT245', 'rev. 9 (9 May 2025)', {
      tpd: [9, 23],
      ten: [11, 38],
      tdis: [15, 38],
    }),
    '85': nexperia('74HC_HCT85', 'rev. 5 (2 April 2024)', {
      'tpd(An, Bn to QA>B, QA<B)': [23, 49],
      'tpd(An, Bn to QA=B)': [21, 44],
      'tpd(IA=B, IA>B to QA<B; IA<B, IA=B to QA>B)': [18, 35],
      'tpd(IA=B to QA=B)': [14, 30],
    }),
    '138': nexperia('74HC_HCT138', 'rev. 10 (26 February 2024)', {
      'tpd(An to Yn)': [15, 38],
      'tpd(E3 to Yn)': [17, 38],
      'tpd(En to Yn)': [17, 38],
    }),
    '139': nexperia('74HC_HCT139', 'rev. 6 (29 February 2024)', {
      'tpd(nAn to nYn)': [14, 36],
      'tpd(nE to nYn)': [12, 34],
    }),
    '147': ti(
      'cd74hc147',
      'SCHS149G (January 2025)',
      'section 4.5 Switching Characteristics',
      { tpd: [18, 40] },
      `Philips 74HC/HCT147 ${PHILIPS_1990}`,
    ),
    '148': ti('sn74hc148', 'SCLS109H (March 2022)', 'section 6.5 Switching Characteristics', {
      'tpd(1-7 to A0-A2)': [23, 45],
      'tpd(0-7 to EO)': [20, 38],
      'tpd(0-7 to GS)': [25, 48],
      'tpd(EI to A0-A2)': [26, 49],
      'tpd(EI to GS)': [19, 36],
      'tpd(EI to EO)': [22, 41],
    }),
    '151': nexperia('74HC_HCT151', 'rev. 11 (11 March 2024)', {
      'tpd(In to Y)': [19, 43],
      'tpd(In to YN)': [21, 46],
      'tpd(Sn to Y)': [22, 46],
      'tpd(Sn to YN)': [22, 51],
      'tpd(E to Y)': [15, 31],
      'tpd(E to YN)': [17, 36],
    }),
    '153': nexperia('74HC_HCT153', 'rev. 11 (11 March 2024)', {
      'tpd(nIn to nY)': [17, 36],
      'tpd(Sn to nY)': [18, 38],
      'tpd(nE to nY)': [12, 25],
    }),
    '157': nexperia('74HC_HCT157', 'rev. 10 (28 May 2024)', {
      'tpd(nI0, nI1 to nY)': [13, 31],
      'tpd(S to nY)': [15, 31],
      'tpd(E to nY)': [14, 29],
    }),
    '158': nexperia('74HC158', 'rev. 4 (23 December 2015)', {
      'tpd(nI0, nI1 to nY)': [15, 31],
      'tpd(E to nY)': [17, 36],
      'tpd(S to nY)': [17, 36],
    }),
    '283': ti(
      'cd74hc283',
      'SCHS176E (July 2022)',
      'section 5.5 Switching Characteristics',
      {
        'tpd(CIN to S0)': [19, 40],
        'tpd(CIN to S1)': [21, 45],
        'tpd(CIN to S2)': [23, 49],
        'tpd(CIN to S3)': [27, 58],
        'tpd(An, Bn to Sn)': [25, 53],
        'tpd(CIN to COUT)': [23, 49],
        'tpd(An, Bn to COUT)': [23, 49],
      },
      `Philips 74HC/HCT283 ${PHILIPS_1990}`,
    ),
    '4511': nexperia(
      '74HC_HCT4511',
      'rev. 4 (28 March 2024)',
      {
        'tpd(A-D to a-g)': [28, 75],
        'tpd(LE to a-g)': [27, 68],
        'tpd(BI to a-g)': [22, 55],
        'tpd(LT to a-g)': [15, 38],
      },
      {
        requirements: {
          'tW(LE)': [16, 4],
          'tsu(A-D to LE)': [12, 5],
          'th(A-D to LE)': [0, -4],
        },
      },
    ),

    // Flip-flops and registers (R09a). Delays and requirements from the same table.
    '74': nexperia(
      '74HC_HCT74',
      'rev. 9 (2 April 2024)',
      {
        'tpd(nCP to nQ, nQN)': [17, 44],
        'tpd(nSD to nQ, nQN)': [18, 50],
        'tpd(nRD to nQ, nQN)': [19, 50],
      },
      {
        table: 8,
        // This revision gives minima only for −40 °C to +85 °C (no 25 °C column).
        minAt: '−40 °C to +85 °C',
        requirements: {
          'tW(nCP)': [20, 7],
          'tW(nSD, nRD)': [20, 7],
          'trec(nSD, nRD)': [8, 1],
          'tsu(nD to nCP)': [15, 2],
          'th(nD to nCP)': [3, -2],
        },
      },
    ),
    '107': nexperia(
      '74HC_HCT107',
      'rev. 7 (20 February 2024)',
      { 'tpd(nCP to nQ, nQN)': [19, 40], 'tpd(nR to nQ, nQN)': [19, 39] },
      {
        requirements: {
          'tW(nCP)': [16, 8],
          'tW(nR)': [16, 8],
          'trec(nR to nCP)': [12, 7],
          'tsu(nJ, nK to nCP)': [20, 8],
          'th(nJ, nK to nCP)': [3, -2],
        },
      },
    ),
    '109': nexperia(
      '74HC_HCT109',
      'rev. 6 (21 February 2024)',
      {
        'tpd(nCP to nQ, nQN)': [18, 44],
        'tPLH(nSD to nQ)': [11, 30],
        'tPHL(nSD to nQN)': [15, 39],
        'tPHL(nRD to nQ)': [15, 46],
        'tPLH(nRD to nQN)': [14, 43],
      },
      {
        requirements: {
          'tW(nCP)': [16, 7],
          'tW(nSD, nRD)': [16, 5],
          'trec(nSD, nRD to nCP)': [14, 7],
          'tsu(nJ, nK to nCP)': [14, 6],
          'th(nJ, nK to nCP)': [5, 0],
        },
      },
    ),
    '112': nexperia(
      '74HC_HCT112',
      'rev. 5 (15 January 2024)',
      {
        'tpd(nCP to nQ, nQN)': [20, 44],
        'tpd(nRD to nQ, nQN)': [21, 45],
        'tpd(nSD to nQ, nQN)': [18, 39],
      },
      {
        requirements: {
          'tW(nCP)': [16, 8],
          'tW(nSD, nRD)': [16, 8],
          'trec(nRD to nCP)': [16, 8],
          'trec(nSD to nCP)': [16, -7],
          'tsu(nJ, nK to nCP)': [16, 7],
          'th(nJ, nK to nCP)': [0, -4],
        },
      },
    ),
    '173': nexperia(
      '74HC_HCT173',
      'rev. 5 (15 January 2024)',
      {
        'tpd(CP to Qn)': [20, 44],
        'tPHL(MR to Qn)': [16, 38],
        'ten(OEn to Qn)': [19, 38],
        'tdis(OEn to Qn)': [19, 38],
      },
      {
        table: 8,
        requirements: {
          'tW(CP)': [16, 5],
          'tW(MR)': [16, 5],
          'trec(MR to CP)': [12, -3],
          'tsu(En to CP)': [20, 12],
          'tsu(Dn to CP)': [12, 6],
          'th(En to CP)': [0, -6],
          'th(Dn to CP)': [1, -4],
        },
      },
    ),
    '175': nexperia(
      '74HC_HCT175',
      'rev. 7 (14 March 2024)',
      { 'tpd(CP to Qn, QnN)': [20, 44], 'tPHL(MR to Qn, QnN)': [18, 38] },
      {
        requirements: {
          'tW(CP)': [16, 8],
          'tW(MR)': [16, 7],
          'trec(MR to CP)': [5, -12],
          'tsu(Dn to CP)': [16, 1],
          'th(Dn to CP)': [5, 0],
        },
      },
    ),
    '273': nexperia(
      '74HC_HCT273',
      'rev. 8 (5 August 2024)',
      { 'tpd(CP to Qn)': [15, 37], 'tPHL(MR to Qn)': [16, 37] },
      {
        requirements: {
          'tW(CP)': [16, 5],
          'tW(MR)': [12, 6],
          'trec(MR to CP)': [10, -2],
          'tsu(Dn to CP)': [12, 4],
          'th(Dn to CP)': [3, -2],
        },
      },
    ),
    '374': nexperia(
      '74HC_HCT374',
      'rev. 6 (5 August 2024)',
      { 'tpd(CP to Qn)': [18, 41], 'ten(OE to Qn)': [15, 38], 'tdis(OE to Qn)': [18, 38] },
      {
        requirements: { 'tW(CP)': [16, 7], 'tsu(Dn to CP)': [12, 5], 'th(Dn to CP)': [5, -2] },
      },
    ),
    '377': nexperia(
      '74HC_HCT377',
      'rev. 6 (5 August 2024)',
      { 'tpd(CP to Qn)': [16, 40] },
      {
        requirements: {
          'tW(CP)': [16, 5],
          'tsu(Dn to CP)': [12, 5],
          'tsu(E to CP)': [12, 2],
          'th(Dn to CP)': [3, -3],
          'th(E to CP)': [4, -1],
        },
      },
    ),
    '574': nexperia(
      '74HC_HCT574',
      'rev. 10 (5 August 2024)',
      { 'tpd(CP to Qn)': [17, 35], 'ten(OE to Qn)': [16, 35], 'tdis(OE to Qn)': [14, 31] },
      {
        requirements: { 'tW(CP)': [16, 5], 'tsu(Dn to CP)': [12, 2], 'th(Dn to CP)': [5, 0] },
      },
    ),

    // Counters and shift registers (R09b). A path a data sheet doesn't give (the 191's TC after
    // a parallel load) borrows a given one in the chip's spec; no value here is made up.
    '161': nexperia(
      '74HC161',
      'rev. 6 (11 March 2024)',
      {
        'tpd(CP to Qn)': [22, 48],
        'tpd(CP to TC)': [25, 54],
        'tpd(CET to TC)': [12, 38],
        'tPHL(MR to Qn)': [23, 53],
        'tPHL(MR to TC)': [23, 55],
      },
      {
        requirements: {
          'tW(CP)': [16, 8],
          'tW(MR)': [16, 7],
          'trec(MR to CP)': [20, 7],
          'tsu(Dn to CP)': [16, 9],
          'tsu(PE to CP)': [20, 11],
          'tsu(CEP, CET to CP)': [34, 17],
          'th(Dn, PE, CEP, CET to CP)': [0, -5],
        },
      },
    ),
    '163': nexperia(
      '74HC_HCT163',
      'rev. 5 (12 October 2018)',
      { 'tpd(CP to Qn)': [20, 46], 'tpd(CP to TC)': [25, 54], 'tpd(CET to TC)': [13, 30] },
      {
        requirements: {
          'tW(CP)': [16, 6],
          'tsu(MR, Dn to CP)': [16, 6],
          'tsu(PE to CP)': [16, 8],
          'tsu(CEP, CET to CP)': [35, 21],
          'th(Dn, PE, CEP, CET, MR to CP)': [0, -5],
        },
      },
    ),
    '164': nexperia(
      '74HC_HCT164',
      'rev. 11 (28 May 2024)',
      { 'tpd(CP to Qn)': [15, 43], 'tPHL(MR to Qn)': [14, 35] },
      {
        requirements: {
          'tW(CP)': [16, 5],
          'tW(MR)': [12, 6],
          'trec(MR to CP)': [12, 6],
          'tsu(DSA, DSB to CP)': [12, 3],
          'th(DSA, DSB to CP)': [4, -2],
        },
      },
    ),
    '165': nexperia(
      '74HC_HCT165',
      'rev. 8 (9 May 2025)',
      {
        'tpd(CP, CE to Q7, Q7N)': [19, 41],
        'tpd(PL to Q7, Q7N)': [18, 41],
        'tpd(D7 to Q7, Q7N)': [13, 30],
      },
      {
        requirements: {
          'tW(CP)': [16, 6],
          'tW(PL)': [16, 5],
          'trec(PL to CP, CE)': [20, 8],
          'tsu(DS to CP, CE)': [16, 4],
          'tsu(CE to CP, CP to CE)': [16, 6],
          'tsu(Dn to PL)': [16, 8],
          'th(DS to CP, CE and Dn to PL)': [5, 2],
          'th(CE to CP, CP to CE)': [5, -6],
        },
      },
    ),
    '191': nexperia(
      '74HC191',
      'rev. 7 (14 March 2024)',
      {
        'tpd(CP to Qn)': [26, 55],
        'tpd(CP to TC)': [30, 64],
        'tpd(CP to RC)': [17, 38],
        'tpd(CE to RC)': [12, 33],
        'tpd(Dn to Qn)': [22, 55],
        'tpd(PL to Qn)': [22, 55],
        'tpd(UD to TC)': [16, 48],
        'tpd(UD to RC)': [18, 53],
      },
      {
        table: 8,
        requirements: {
          'tW(CP)': [25, 10],
          'tW(PL)': [20, 8],
          'trec(PL to CP)': [7, 3],
          'tsu(UD to CP)': [41, 18],
          'tsu(CE to CP)': [28, 16],
          'tsu(Dn to PL)': [20, 7],
          'th(UD to CP)': [0, -14],
          'th(CE to CP)': [0, -10],
          'th(Dn to PL)': [0, -4],
        },
      },
    ),
    '193': nexperia(
      '74HC_HCT193',
      'rev. 8 (14 March 2024)',
      {
        'tpd(CPU, CPD to Qn)': [23, 54],
        'tpd(CPU to TCU)': [14, 31],
        'tpd(CPD to TCD)': [14, 31],
        'tpd(PL to Qn)': [25, 55],
        'tpd(MR to Qn)': [21, 50],
        'tpd(Dn to Qn)': [25, 53],
        'tpd(PL to TCU, TCD)': [29, 73],
        'tpd(MR to TCU, TCD)': [27, 71],
        'tpd(Dn to TCU, TCD)': [29, 73],
      },
      {
        table: 8,
        requirements: {
          'tW(CPU, CPD)': [20, 8],
          'tW(MR)': [20, 9],
          'tW(PL)': [20, 7],
          'trec(PL to CPU, CPD)': [10, 3],
          'trec(MR to CPU, CPD)': [10, 0],
          'tsu(Dn to PL)': [16, 8],
          'th(Dn to PL)': [0, -5],
          'th(CPU to CPD, CPD to CPU)': [16, 8],
        },
      },
    ),
    '595': nexperia(
      '74HC_HCT595',
      'rev. 12 (20 March 2024)',
      {
        'tpd(SHCP to Q7S)': [19, 40],
        'tpd(STCP to Qn)': [20, 44],
        'tPHL(MR to Q7S)': [17, 44],
        'ten(OE to Qn)': [17, 38],
        'tdis(OE to Qn)': [15, 38],
      },
      {
        requirements: {
          'tW(SHCP)': [15, 6],
          'tW(STCP)': [15, 4],
          'tW(MR)': [15, 6],
          'trec(MR to SHCP)': [10, -7],
          'tsu(DS to SHCP)': [10, 4],
          'tsu(SHCP to STCP)': [15, 8],
          'th(DS to SHCP)': [3, -2],
        },
      },
    ),
    '4040': nexperia(
      '74HC_HCT4040',
      'rev. 8 (16 February 2024)',
      { 'tpd(CP to Q0)': [17, 38], 'tpd(Qn to Qn+1)': [10, 25], 'tPHL(MR to Qn)': [22, 46] },
      { requirements: { 'tW(CP)': [16, 5], 'tW(MR)': [16, 8], 'trec(MR to CP)': [10, 3] } },
    ),
  },
};
