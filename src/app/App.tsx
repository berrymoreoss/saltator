import { Registry } from '../core';
import { DEV_PARTS, Editor } from '../editor';
import { createDefaultRegistry } from '../library';
import { createSettingsStore, createUiState, type Example, Workbench } from '../ui';
import { helloLed, nandGrid, symbolGallery } from './examples';

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
  ...(import.meta.env.DEV
    ? [
        {
          id: 'stress',
          label: 'Stress Test (3 600 NANDs)',
          circuit: () => nandGrid(registry, 60, 60),
        },
      ]
    : []),
];

// `?example=<id>` (or `?gallery`) opens an example instead of Hello LED.
const params = new URLSearchParams(window.location.search);
const startId = params.get('example') ?? (params.has('gallery') ? 'gallery' : 'hello-led');
const start = examples.find((e) => e.id === startId) ?? examples[0]!;
const editor = new Editor(registry, start.circuit());
const settings = createSettingsStore();
const ui = createUiState();

// Dev builds expose the editor for poking at it from the console.
if (import.meta.env.DEV) Object.assign(window, { logicEditor: editor });

/** The composition root: one editor, the settings and UI stores, the workbench around them. */
export function App() {
  return <Workbench editor={editor} settings={settings} ui={ui} examples={examples} />;
}
