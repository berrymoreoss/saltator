import type { Circuit } from '../circuit';
import { Store } from '../editor';
import type { PartPick } from './part-info';
import {
  browserStorage,
  type KeyValueStorage,
  loadSettings,
  type Settings,
  saveSettings,
} from './settings';

/** A built-in document the File menu can open (R07 replaces these with real files). */
export interface Example {
  readonly id: string;
  readonly label: string;
  readonly circuit: () => Circuit;
}

export type DialogId = 'shortcuts' | 'about';

/** Transient UI state (not remembered across reloads). */
export interface UiState {
  readonly dialog?: DialogId;
  /** Incremented to ask the Parts panel to focus its search box. */
  readonly searchRequest: number;
  /** Incremented to ask the Properties panel to focus the designator field. */
  readonly propertiesRequest: number;
  /** The part the Part tab shows: the last one picked on the canvas or in the Parts panel. */
  readonly partPick?: PartPick;
}

export function createUiState(): Store<UiState> {
  return new Store<UiState>({ searchRequest: 0, propertiesRequest: 0 });
}

/** Settings loaded from storage and saved back (debounced) whenever they change. */
export function createSettingsStore(
  storage: KeyValueStorage | undefined = browserStorage(),
): Store<Settings> {
  const store = new Store(loadSettings(storage));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    timer = undefined;
    saveSettings(storage, store.get());
  };
  store.subscribe(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(save, 250);
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        save();
      }
    });
  }
  return store;
}
