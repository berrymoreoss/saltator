/**
 * 74HC timing from the Nexperia product data sheets (74HC; 74HCT), table 7 "Dynamic
 * characteristics" of each. Every delay at VCC = 4.5 V, CL = 50 pF: the only condition with
 * typical `ten`/`tdis` and the one the maxima are given at (docs/components.md#timing).
 */
import { ns, type TimingDef } from '../../core';
import type { ChipTiming, LogicFamily } from './chip';

const CONDITIONS = 'VCC = 4.5 V, CL = 50 pF; typ at 25 °C, max at −40 °C to +85 °C';

/** `delays`: datasheet symbol → [typical at 25 °C, max at −40 °C to +85 °C] in ns. */
function nexperia(
  document: string,
  revision: string,
  delays: Readonly<Record<string, readonly [typ: number, max: number]>>,
): ChipTiming {
  const pick = (i: 0 | 1) =>
    Object.fromEntries(Object.entries(delays).map(([symbol, values]) => [symbol, ns(values[i])]));
  const timing: TimingDef = {
    typical: pick(0),
    max: pick(1),
    conditions: CONDITIONS,
    source: `Nexperia ${document} product data sheet, ${revision}, table 7`,
  };
  return { datasheet: `https://assets.nexperia.com/documents/data-sheet/${document}.pdf`, timing };
}

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
  },
};
