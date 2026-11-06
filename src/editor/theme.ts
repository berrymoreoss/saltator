/**
 * Canvas colors. The UI picks the theme (dark or light, following the OS by default) and passes
 * the matching `CanvasTheme`, so the canvas and the chrome always agree.
 */

/**
 * How a net looks while simulating: its level and whether it is driven strongly, only pulled
 * (`WEAK_*`), or shorted (`CONTENTION`: two strong drivers disagree). `NONE`: not simulated.
 */
export const SignalStyle = {
  NONE: 0,
  L0: 1,
  L1: 2,
  Z: 3,
  X: 4,
  WEAK_0: 5,
  WEAK_1: 6,
  CONTENTION: 7,
} as const;
export type SignalStyle = (typeof SignalStyle)[keyof typeof SignalStyle];

/** Wire colors by signal style. */
export interface LevelColors {
  readonly l0: string;
  readonly l1: string;
  readonly z: string;
  readonly x: string;
  /** Only pulled to 0 / 1 (a pull resistor, nothing driving). */
  readonly weak0: string;
  readonly weak1: string;
  /** The dim phase of a flashing contention. */
  readonly contentionDim: string;
}

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
  /** Wires while simulating. */
  readonly levels: LevelColors;
}

/** The color of a wire in `style`; `bright`: the bright phase of a flashing contention. */
export function signalColor(theme: CanvasTheme, style: SignalStyle, bright = true): string {
  const c = theme.levels;
  switch (style) {
    case SignalStyle.NONE:
      return theme.wire;
    case SignalStyle.L0:
      return c.l0;
    case SignalStyle.L1:
      return c.l1;
    case SignalStyle.Z:
      return c.z;
    case SignalStyle.X:
      return c.x;
    case SignalStyle.WEAK_0:
      return c.weak0;
    case SignalStyle.WEAK_1:
      return c.weak1;
    case SignalStyle.CONTENTION:
      return bright ? c.x : c.contentionDim;
  }
}

export const DARK_CANVAS: CanvasTheme = {
  name: 'dark',
  background: '#17191d',
  gridDot: '#3a3f48',
  gridMajor: '#5a616c',
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
  levels: {
    l0: '#23843f',
    l1: '#4be36f',
    z: '#4d8fea',
    x: '#ff5a52',
    weak0: '#4f7a5b',
    weak1: '#a8e6b8',
    contentionDim: '#6e2622',
  },
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
  levels: {
    l0: '#14532d',
    l1: '#18b04a',
    z: '#2563eb',
    x: '#dc2626',
    weak0: '#6f927a',
    weak1: '#8fd3a4',
    contentionDim: '#f2b8b5',
  },
};
