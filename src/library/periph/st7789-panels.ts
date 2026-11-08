/**
 * The glass panels an ST7789V module comes with, as data: each one's size and its window in the
 * controller's 240 × 320 frame memory (the columns and rows of the memory its sources and gates
 * are wired to). Sources: the LCDWiki module documents (MSP2008, MSP1308, MSP1141 — panel specs
 * QDTFT2009, TFT1301, TFT1141) and their vendor programs' offsets per orientation.
 * Spec: docs/components.md#st7789.
 */

/** Frame memory columns (sources). */
export const GRAM_WIDTH = 240;
/** Frame memory rows (gates). */
export const GRAM_HEIGHT = 320;

export const ST7789_PANELS = ['240x320', '240x240', '135x240'] as const;
export type St7789Panel = (typeof ST7789_PANELS)[number];

export const ST7789_PANEL_LABELS: Readonly<Record<St7789Panel, string>> = {
  '240x320': '240 × 320 (2.0")',
  '240x240': '240 × 240 (1.3", 1.54")',
  '135x240': '135 × 240 (1.14")',
};

/** A panel's glass and where it sits in the frame memory (physical, MADCTL = 00h). */
export interface St7789Glass {
  /** Glass pixels across. */
  readonly width: number;
  /** Glass pixels down. */
  readonly height: number;
  /** First frame memory column the glass shows. */
  readonly column: number;
  /** First frame memory row the glass shows. */
  readonly row: number;
}

const GLASSES: Readonly<Record<St7789Panel, St7789Glass>> = {
  '240x320': { width: 240, height: 320, column: 0, row: 0 },
  // The vendor program writes rows 80–319 when MY = 1: the glass is on rows 0–239.
  '240x240': { width: 240, height: 240, column: 0, row: 0 },
  // Offsets (52, 40) at MADCTL 00h and (53, 40) with MX: columns 52–186, rows 40–279.
  '135x240': { width: 135, height: 240, column: 52, row: 40 },
};

export function st7789Glass(panel: St7789Panel): St7789Glass {
  return GLASSES[panel];
}
