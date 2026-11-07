/**
 * 74HC timing from the Nexperia product data sheets (74HC; 74HCT), table 7 "Dynamic
 * characteristics" of each; TI data sheets for the chips Nexperia doesn't document (147, 148,
 * 283). Every delay at VCC = 4.5 V, CL = 50 pF: the only condition with typical `ten`/`tdis` and
 * the one the maxima are given at (docs/components.md#timing). Chips with several delay paths
 * key each one by the data sheet's wording: `tpd(An to Yn)`.
 */
import { ns, type TimingDef } from '../../core';
import type { ChipTiming, LogicFamily } from './chip';

const CONDITIONS = 'VCC = 4.5 V, CL = 50 pF; typ at 25 °C, max at −40 °C to +85 °C';

/** Datasheet symbol → [typical at 25 °C, max at −40 °C to +85 °C] in ns. */
type Delays = Readonly<Record<string, readonly [typ: number, max: number]>>;

function chipTiming(datasheet: string, source: string, delays: Delays): ChipTiming {
  const pick = (i: 0 | 1) =>
    Object.fromEntries(Object.entries(delays).map(([symbol, values]) => [symbol, ns(values[i])]));
  const timing: TimingDef = { typical: pick(0), max: pick(1), conditions: CONDITIONS, source };
  return { datasheet, timing };
}

function nexperia(document: string, revision: string, delays: Delays): ChipTiming {
  return chipTiming(
    `https://assets.nexperia.com/documents/data-sheet/${document}.pdf`,
    `Nexperia ${document} product data sheet, ${revision}, table 7`,
    delays,
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
    '4511': nexperia('74HC_HCT4511', 'rev. 4 (28 March 2024)', {
      'tpd(A-D to a-g)': [28, 75],
      'tpd(LE to a-g)': [27, 68],
      'tpd(BI to a-g)': [22, 55],
      'tpd(LT to a-g)': [15, 38],
    }),
  },
};
