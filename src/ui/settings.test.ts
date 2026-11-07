import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  effectiveTheme,
  type KeyValueStorage,
  loadSettings,
  PANEL_LIMITS,
  parseSettings,
  SETTINGS_KEY,
  saveSettings,
} from './settings';

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('settings', () => {
  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const settings = { ...DEFAULT_SETTINGS, theme: 'light' as const, gateStyle: 'iec' as const };
    saveSettings(storage, settings);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('falls back to defaults for missing, corrupt or blocked storage', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(throwing, DEFAULT_SETTINGS)).not.toThrow();
  });

  it('repairs invalid fields one by one and clamps panel sizes', () => {
    const settings = parseSettings({
      theme: 'purple',
      gateStyle: 'iec',
      showGrid: 'yes',
      panels: { parts: { visible: false, size: 5000 }, bottom: 'x' },
    });
    expect(settings.theme).toBe('system');
    expect(settings.gateStyle).toBe('iec');
    expect(settings.showGrid).toBe(true);
    expect(settings.panels.parts).toEqual({ visible: false, size: PANEL_LIMITS.parts.max });
    expect(settings.panels.bottom).toEqual(DEFAULT_SETTINGS.panels.bottom);
    expect(settings.bottomTab).toBe('messages');
    expect(parseSettings({ bottomTab: 'simulation' }).bottomTab).toBe('simulation');
    expect(parseSettings({ bottomTab: 'part' }).bottomTab).toBe('part');
    expect(parseSettings({ bottomTab: 'memory' }).bottomTab).toBe('memory');
    expect(parseSettings({}).memoryFollow).toBe(true);
    expect(parseSettings({ memoryFollow: false }).memoryFollow).toBe(false);
    expect(parseSettings({ memoryFollow: 'no' }).memoryFollow).toBe(true);
    expect(parseSettings({ bottomTab: 'analyzer' }).bottomTab).toBe('messages');
  });

  it('follows the OS for the system theme', () => {
    expect(effectiveTheme('system', true)).toBe('dark');
    expect(effectiveTheme('system', false)).toBe('light');
    expect(effectiveTheme('light', true)).toBe('light');
  });
});
