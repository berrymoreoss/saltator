import { Registry } from '../core';
import { DEV_PARTS, Editor } from '../editor';
import { createDefaultRegistry } from '../library';
import { createSettingsStore, createUiState, type Example, Workbench } from '../ui';
import { helloLed, symbolGallery } from './examples';

// The renderer fixtures (DIP packages before R06, the generic box) exist in dev builds only.
const registry = new Registry([
  ...createDefaultRegistry().list(),
  ...(import.meta.env.DEV ? DEV_PARTS : []),
]);

const examples: readonly Example[] = [
  { id: 'hello-led', label: 'Hello, LED', circuit: () => helloLed(registry) },
  {
    id: 'gallery',
    label: 'Symbol Gallery',
    circuit: () => symbolGallery(registry, import.meta.env.DEV),
  },
];

const start = new URLSearchParams(window.location.search).has('gallery') ? 1 : 0;
const editor = new Editor(registry, examples[start]!.circuit());
const settings = createSettingsStore();
const ui = createUiState();

// Dev builds expose the editor for poking at it from the console.
if (import.meta.env.DEV) Object.assign(window, { logicEditor: editor });

/** The composition root: one editor, the settings and UI stores, the workbench around them. */
export function App() {
  return <Workbench editor={editor} settings={settings} ui={ui} examples={examples} />;
}
