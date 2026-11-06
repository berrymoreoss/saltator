import { type Circuit, type CircuitDocument, SCHEMA_VERSION } from '../circuit';
import { Registry } from '../core';
import { DEV_PARTS, Editor } from '../editor';
import { createDefaultRegistry } from '../library';
import {
  askUnsavedVia,
  browserFileAccess,
  createSettingsStore,
  createUiState,
  DocumentController,
  type Example,
  exampleSession,
  reportVia,
  Workbench,
} from '../ui';
import { EXAMPLE_FILES, exampleDocument } from './example-files';
import { nandGrid, symbolGallery } from './examples';

// The renderer fixtures (a clock pin and a 28-pin DIP no shipped part has yet, the generic box)
// exist in dev builds only.
const registry = new Registry([
  ...createDefaultRegistry().list(),
  ...(import.meta.env.DEV ? DEV_PARTS : []),
]);

const generated = (circuit: () => Circuit) => (): CircuitDocument => ({
  schemaVersion: SCHEMA_VERSION,
  circuits: [circuit()],
});

const examples: readonly Example[] = [
  ...EXAMPLE_FILES.map((file) => ({
    id: file.id,
    label: file.title,
    description: file.description,
    document: () => exampleDocument(file.id),
  })),
  {
    id: 'gallery',
    label: 'Symbol Gallery',
    description: 'Every part, with its prop variants and placements.',
    document: generated(() => symbolGallery(registry, import.meta.env.DEV)),
  },
  ...(import.meta.env.DEV
    ? [
        {
          id: 'stress',
          label: 'Stress Test (3 600 NANDs)',
          document: generated(() => nandGrid(registry, 60, 60)),
        },
      ]
    : []),
];

// `?example=<id>` (or `?gallery`) opens an example instead of Hello LED.
const params = new URLSearchParams(window.location.search);
const startId = params.get('example') ?? (params.has('gallery') ? 'gallery' : 'hello-led');
const start = examples.find((e) => e.id === startId) ?? examples[0]!;
const editor = new Editor(registry);
const settings = createSettingsStore();
const ui = createUiState();
const documents = new DocumentController({
  editor,
  files: browserFileAccess(),
  askUnsaved: askUnsavedVia(ui),
  report: reportVia(ui),
});
documents.show(exampleSession(start.label, start.document()));

// Dev builds expose the editor for poking at it from the console.
if (import.meta.env.DEV) Object.assign(window, { logicEditor: editor, logicDocuments: documents });

/** The composition root: one editor, the settings and UI stores, the workbench around them. */
export function App() {
  return (
    <Workbench
      editor={editor}
      documents={documents}
      settings={settings}
      ui={ui}
      examples={examples}
    />
  );
}
