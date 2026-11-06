/**
 * Canvas colors. The UI picks the theme (dark or light, following the OS by default) and passes
 * the matching `CanvasTheme`, so the canvas and the chrome always agree. R05 adds signal-level
 * colors.
 */
export interface CanvasTheme {
  readonly name: 'dark' | 'light';
  readonly background: string;
  readonly gridDot: string;
  readonly gridMajor: string;
  /** Wires while not simulating. */
  readonly wire: string;
  readonly junction: string;
  /** Part outlines and line art. */
  readonly partStroke: string;
  /** Part body fill. */
  readonly partFill: string;
  readonly pin: string;
  /** Designators, labels, names. */
  readonly text: string;
  /** Pin names and numbers. */
  readonly pinText: string;
  /** Unconnected pin ends. */
  readonly openPin: string;
  readonly selection: string;
  readonly selectionFill: string;
  readonly hover: string;
  readonly error: string;
  readonly warning: string;
}

export const DARK_CANVAS: CanvasTheme = {
  name: 'dark',
  background: '#17191d',
  gridDot: '#30343b',
  gridMajor: '#4a505a',
  wire: '#9fb3c8',
  junction: '#9fb3c8',
  partStroke: '#e0b979',
  partFill: '#25231f',
  pin: '#b9a07a',
  text: '#d6dbe2',
  pinText: '#9aa3ad',
  openPin: '#7d8590',
  selection: '#58a6ff',
  selectionFill: 'rgba(88, 166, 255, 0.12)',
  hover: 'rgba(88, 166, 255, 0.35)',
  error: '#f85149',
  warning: '#d29922',
};

export const LIGHT_CANVAS: CanvasTheme = {
  name: 'light',
  background: '#fbfaf6',
  gridDot: '#d5d2c8',
  gridMajor: '#a9a598',
  wire: '#2f5f3a',
  junction: '#2f5f3a',
  partStroke: '#8c2a1c',
  partFill: '#fff7d6',
  pin: '#8c2a1c',
  text: '#3a3328',
  pinText: '#6b5a4a',
  openPin: '#8a8578',
  selection: '#0969da',
  selectionFill: 'rgba(9, 105, 218, 0.10)',
  hover: 'rgba(9, 105, 218, 0.30)',
  error: '#cf222e',
  warning: '#9a6700',
};
