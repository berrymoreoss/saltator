import type { CircuitDocument } from '../circuit';
import { Store } from '../editor';
import type { FileProblem, UnsavedChoice } from './document-controller';
import type { PartPick } from './part-info';
import {
  browserStorage,
  type KeyValueStorage,
  loadSettings,
  type Settings,
  saveSettings,
} from './settings';

/** An example circuit the File menu opens as an untitled copy. */
export interface Example {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly document: () => CircuitDocument;
}

export type DialogId = 'shortcuts' | 'about' | 'examples';

/** "Save changes to “name”?" waiting for an answer. */
export interface UnsavedQuestion {
  readonly name: string;
  readonly answer: (choice: UnsavedChoice) => void;
}

/** Transient UI state (not remembered across reloads). */
export interface UiState {
  readonly dialog?: DialogId;
  /** Incremented to ask the Parts panel to focus its search box. */
  readonly searchRequest: number;
  /** Incremented to ask the Properties panel to focus the designator field. */
  readonly propertiesRequest: number;
  /** The part the Part tab shows: the last one picked on the canvas or in the Parts panel. */
  readonly partPick?: PartPick;
  /** The memory the Memory tab shows: the last one picked on the canvas or in its picker. */
  readonly memoryPick?: string;
  readonly unsavedQuestion?: UnsavedQuestion;
  /** A file that didn't open or save, shown until dismissed. */
  readonly fileProblem?: FileProblem;
}

export function createUiState(): Store<UiState> {
  return new Store<UiState>({ searchRequest: 0, propertiesRequest: 0 });
}

/** Asks "Save changes?" through the UI state (the workbench shows the dialog). */
export function askUnsavedVia(ui: Store<UiState>): (name: string) => Promise<UnsavedChoice> {
  return (name) =>
    new Promise((resolve) => {
      const answer = (choice: UnsavedChoice) => {
        ui.update(({ unsavedQuestion: _, ...rest }) => rest);
        resolve(choice);
      };
      ui.update((s) => ({ ...s, unsavedQuestion: { name, answer } }));
    });
}

/** Shows a file problem through the UI state. */
export function reportVia(ui: Store<UiState>): (problem: FileProblem) => void {
  return (problem) => ui.update((s) => ({ ...s, fileProblem: problem }));
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
