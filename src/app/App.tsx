import { type Circuit, type CircuitDocument, SCHEMA_VERSION } from '../circuit';
import { Registry } from '../core';
import { DEV_PARTS, Editor } from '../editor';
import { createDefaultRegistry } from '../library';
import {
  Autosave,
  askUnsavedVia,
  browserFileAccess,
  browserImageAccess,
  browserLocks,
  claimSessionId,
  createSettingsStore,
  createUiState,
  DocumentController,
  type Example,
  exampleSession,
  IndexedDbRecentStore,
  IndexedDbSessionStore,
  iframeSandbox,
  KEPT_SESSIONS,
  openDatabase,
  RecentFiles,
  recoverUnloadWrites,
  reportVia,
  sameFileHandle,
  sessionToRestore,
  TestRunner,
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

const editor = new Editor(registry);
const settings = createSettingsStore();
const ui = createUiState();
const files = browserFileAccess();
const images = browserImageAccess();
// Test scripts run in a sandbox (R15b): the runner bundle, loaded the first time it's needed.
const runnerSource = () =>
  import('virtual:bench-runner').then(({ benchRunnerSource }) => benchRunnerSource);
/** Lists scripts as they are typed; runs benches (two sandboxes: a run doesn't hold lists up). */
const tests = {
  checker: new TestRunner(iframeSandbox(runnerSource)),
  runner: new TestRunner(iframeSandbox(runnerSource)),
};
const documents = new DocumentController({
  editor,
  files,
  askUnsaved: askUnsavedVia(ui),
  report: reportVia(ui),
});

// The browser's storage for autosave and Open Recent; none where it is blocked (private mode).
const database = await openDatabase().catch(() => undefined);

/** The autosave store and this tab's session id. */
async function openSessions(db: IDBDatabase) {
  try {
    const tab = await claimSessionId(window.sessionStorage, browserLocks(), () =>
      crypto.randomUUID(),
    );
    return { store: new IndexedDbSessionStore(db), ...tab };
  } catch {
    return undefined;
  }
}

// Open Recent needs file handles (File System Access): Chromium only.
const recent =
  database && files.kind === 'native'
    ? new RecentFiles({
        store: new IndexedDbRecentStore(database),
        sameFile: sameFileHandle,
        now: Date.now,
        newId: () => crypto.randomUUID(),
      })
    : undefined;
await recent?.load().catch(() => undefined);

// Start-up: `?example=<id>` (or `?gallery`) opens that example; otherwise this tab's autosaved
// session comes back as it was (or the most recent one in a new tab); a first launch opens
// Hello, LED.
const params = new URLSearchParams(window.location.search);
const exampleId = params.get('example') ?? (params.has('gallery') ? 'gallery' : undefined);
const sessions = database && (await openSessions(database));
const local = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();
if (sessions) await recoverUnloadWrites(sessions.store, local).catch(() => undefined);
const restored =
  exampleId === undefined && sessions
    ? await sessionToRestore(sessions.store, sessions.id, sessions.restoreFrom).catch(
        () => undefined,
      )
    : undefined;
if (restored) {
  documents.show(restored.session, restored.document, {
    ...(restored.open !== undefined && { open: restored.open }),
    ...(restored.path !== undefined && { path: restored.path }),
    ...(restored.camera && { camera: restored.camera }),
  });
  // After the document: showing one starts the debugger afresh.
  if (restored.debug) editor.debug.load(restored.debug);
} else {
  const start = examples.find((e) => e.id === exampleId) ?? examples[0]!;
  documents.show(exampleSession(start.label, start.document()));
}
if (sessions) {
  const autosave = new Autosave({
    store: sessions.store,
    id: sessions.id,
    editor,
    documents,
    now: Date.now,
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    onError: (error) => console.warn('Autosave failed:', error),
  });
  autosave.start({ stored: restored?.stored ?? false });
  window.addEventListener('pagehide', () => autosave.flushOnUnload(local));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void autosave.flush();
  });
  void sessions.store.prune(KEPT_SESSIONS).catch(() => undefined);
}

// Every file the document is opened from or saved to goes to the top of Open Recent.
if (recent) {
  let file = documents.session.get().file;
  documents.session.subscribe(() => {
    const session = documents.session.get();
    if (session.file === undefined || session.file === file) return;
    file = session.file;
    void recent.add(session.file.name, session.file).catch(() => undefined);
  });
}

// Dev builds expose the editor for poking at it from the console.
if (import.meta.env.DEV) {
  Object.assign(window, { logicEditor: editor, logicDocuments: documents, logicTests: tests });
}

/** The composition root: one editor, the settings and UI stores, the workbench around them. */
export function App() {
  return (
    <Workbench
      editor={editor}
      documents={documents}
      recent={recent}
      settings={settings}
      ui={ui}
      examples={examples}
      images={images}
    />
  );
}
