/**
 * User settings of the app (view preferences and panel layout), remembered per browser in
 * `localStorage`. Reading never fails: missing, corrupt or blocked storage gives the defaults.
 */
import type { GateStyle, WheelMode } from '../editor';

export type ThemeSetting = 'system' | 'dark' | 'light';
export type PanelId = 'circuits' | 'parts' | 'properties' | 'bottom';
/**
 * Tabs of the bottom dock: design checks, what happened while simulating, the part, memories,
 * waveforms, the debugger, the test benches.
 */
export type BottomTab = 'messages' | 'simulation' | 'part' | 'memory' | 'waves' | 'debug' | 'tests';
const BOTTOM_TABS: readonly BottomTab[] = [
  'messages',
  'simulation',
  'part',
  'memory',
  'waves',
  'debug',
  'tests',
];

export interface PanelSettings {
  readonly visible: boolean;
  /** Width (side docks), or height (the bottom dock, the Circuits list above Parts) in px. */
  readonly size: number;
}

export interface Settings {
  readonly theme: ThemeSetting;
  readonly gateStyle: GateStyle;
  readonly showGrid: boolean;
  readonly wheel: WheelMode;
  readonly panels: Readonly<Record<PanelId, PanelSettings>>;
  readonly bottomTab: BottomTab;
  /** The Memory tab scrolls to keep the address on the chip's pins in view. */
  readonly memoryFollow: boolean;
}

/** Size limits of the docks, in px. */
export const PANEL_LIMITS: Readonly<Record<PanelId, { min: number; max: number }>> = {
  circuits: { min: 60, max: 480 },
  parts: { min: 160, max: 480 },
  properties: { min: 200, max: 520 },
  bottom: { min: 80, max: 480 },
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  gateStyle: 'ansi',
  showGrid: true,
  wheel: 'pan',
  panels: {
    circuits: { visible: true, size: 120 },
    parts: { visible: true, size: 232 },
    properties: { visible: true, size: 264 },
    bottom: { visible: true, size: 148 },
  },
  bottomTab: 'messages',
  memoryFollow: true,
};

export const SETTINGS_KEY = 'saltator.settings.v1';

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function panel(value: unknown, id: PanelId): PanelSettings {
  const raw = record(value);
  const fallback = DEFAULT_SETTINGS.panels[id];
  const { min, max } = PANEL_LIMITS[id];
  const size = typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : fallback.size;
  return {
    visible: typeof raw.visible === 'boolean' ? raw.visible : fallback.visible,
    size: Math.round(Math.min(max, Math.max(min, size))),
  };
}

/** Settings from stored JSON: unknown fields are ignored, invalid ones get their default. */
export function parseSettings(value: unknown): Settings {
  const raw = record(value);
  const panels = record(raw.panels);
  return {
    theme: oneOf(raw.theme, ['system', 'dark', 'light'], DEFAULT_SETTINGS.theme),
    gateStyle: oneOf(raw.gateStyle, ['ansi', 'iec'], DEFAULT_SETTINGS.gateStyle),
    showGrid: typeof raw.showGrid === 'boolean' ? raw.showGrid : DEFAULT_SETTINGS.showGrid,
    wheel: oneOf(raw.wheel, ['pan', 'zoom'], DEFAULT_SETTINGS.wheel),
    panels: {
      circuits: panel(panels.circuits, 'circuits'),
      parts: panel(panels.parts, 'parts'),
      properties: panel(panels.properties, 'properties'),
      bottom: panel(panels.bottom, 'bottom'),
    },
    bottomTab: oneOf(raw.bottomTab, BOTTOM_TABS, DEFAULT_SETTINGS.bottomTab),
    memoryFollow:
      typeof raw.memoryFollow === 'boolean' ? raw.memoryFollow : DEFAULT_SETTINGS.memoryFollow,
  };
}

/** Minimal storage interface (`localStorage`), so tests can pass a fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSettings(storage: KeyValueStorage | undefined): Settings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return text ? parseSettings(JSON.parse(text)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(storage: KeyValueStorage | undefined, settings: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked (private mode): settings just aren't remembered.
  }
}

/** `localStorage`, or undefined where accessing it throws (blocked site data). */
export function browserStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The theme actually shown. */
export function effectiveTheme(setting: ThemeSetting, prefersDark: boolean): 'dark' | 'light' {
  return setting === 'system' ? (prefersDark ? 'dark' : 'light') : setting;
}
