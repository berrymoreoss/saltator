import { Eraser } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { DARK_CANVAS, type Editor, LIGHT_CANVAS, Store } from '../editor';
import { Breadcrumbs } from './Breadcrumbs';
import { CircuitsPanel } from './CircuitsPanel';
import { ContextMenu } from './ContextMenu';
import { ClipboardBridge } from './clipboard';
import { CommandRegistry, dispatchShortcut } from './commands';
import { BreakpointDialog, DebugBadge, DebugPanel } from './DebugPanel';
import { AboutDialog, FileProblemDialog, ShortcutsDialog, UnsavedChangesDialog } from './Dialogs';
import type { DocumentController } from './document-controller';
import { documentTitle, hasUnsavedChanges } from './document-session';
import { ExampleGalleryDialog } from './ExampleGallery';
import { droppedFile, type ImageFileAccess } from './files';
import { useMediaQuery, useStore, useStoreValue } from './hooks';
import { MemoryImageActions } from './ImageDialogs';
import { MemoryPanel } from './MemoryPanel';
import { MenuBar } from './MenuBar';
import { MessagesBadges, MessagesPanel } from './MessagesPanel';
import { ModuleView } from './ModuleView';
import { ModuleDrafts } from './module-view';
import { Panel, Splitter } from './Panel';
import { PartInfoPanel } from './PartInfoPanel';
import { PartsPanel } from './PartsPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { PART_DRAG_TYPE, placeableParts } from './parts-filter';
import type { RecentFile, RecentFiles } from './recent-files';
import { SpeedSelect } from './SimControls';
import { SimulationBadges, SimulationPanel } from './SimulationPanel';
import { StatusBar } from './StatusBar';
import {
  type BottomTab,
  effectiveTheme,
  PANEL_LIMITS,
  type PanelId,
  type Settings,
} from './settings';
import { isMacPlatform } from './shortcuts';
import { TestsBadge, TestsPanel } from './TestsPanel';
import { Toolbar } from './Toolbar';
import type { TestSession } from './test-session';
import type { Example, UiState } from './ui-state';
import { VcdExportAction, WaveformsPanel, WavesBadge } from './WaveformsPanel';
import { createCommands, memoryOfPart, TOOLBAR, workbenchMenus } from './workbench-commands';
import './styles/tokens.css';
import './styles/workbench.css';
import './styles/panels.css';

export interface WorkbenchProps {
  readonly editor: Editor;
  readonly documents: DocumentController;
  /** File ▸ Open Recent (where the browser gives file handles). */
  readonly recent?: RecentFiles;
  readonly settings: Store<Settings>;
  readonly ui: Store<UiState>;
  readonly examples: readonly Example[];
  /** Memory image files (`.bin`, Intel HEX) for the Memory tab. */
  readonly images?: ImageFileAccess;
  /** The test benches: the Tests tab and the Test menu (R15b). */
  readonly tests: TestSession;
}

const MAC = typeof navigator !== 'undefined' && isMacPlatform(navigator.platform);
const NO_RECENT = new Store<readonly RecentFile[]>([]);

/**
 * The desktop CAD-style shell: menu bar, toolbar, Parts dock (left), canvas, Properties dock
 * (right), bottom dock with tabs, status bar. Spec: docs/editor.md#shell.
 */
export function Workbench({
  editor,
  documents,
  recent,
  settings: settingsStore,
  ui,
  examples,
  images,
  tests,
}: WorkbenchProps) {
  const settings = useStore(settingsStore);
  // Toolbar and menus read the tool, history and settings through their commands: re-render on
  // change.
  useStore(editor.tool);
  useStore(editor.history);
  // Run/Pause, Step, Stop, Reset depend on the run state (not on the time, which ticks).
  useStoreValue(editor.simulation.status, (status) => status.state);
  // Cancel Tests is on while a run goes on.
  useStoreValue(tests.state, (state) => state.run !== undefined);
  useStoreValue(
    editor.state,
    (state) => state.selection.parts.size + state.selection.wires.size > 0,
  );
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = effectiveTheme(settings.theme, prefersDark);
  const canvasTheme = theme === 'dark' ? DARK_CANVAS : LIGHT_CANVAS;
  const uiState = useStore(ui);

  const clipboard = useMemo(() => new ClipboardBridge(editor), [editor]);
  // The JSON in each Verilog module's editor (HDL-1): the session's, forgotten with its document.
  const drafts = useMemo(() => new ModuleDrafts(), []);
  useEffect(() => documents.shown.subscribe(() => drafts.clear()), [documents, drafts]);
  const commands = useMemo(
    () =>
      new CommandRegistry(
        createCommands({
          editor,
          documents,
          recent,
          clipboard,
          settings: settingsStore,
          ui,
          examples,
          tests,
        }),
      ),
    [editor, documents, recent, clipboard, settingsStore, ui, examples, tests],
  );
  const tool = useStore(editor.tool);
  const recentCount = useStoreValue(recent?.list ?? NO_RECENT, (list) => list.length);
  const menus = useMemo(
    () => workbenchMenus(examples, recent && recentCount),
    [examples, recent, recentCount],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // A boolean, so an edit re-renders the shell only when it changes.
  const session = useStore(documents.session);
  const unsaved = useStoreValue(editor.state, (state) =>
    hasUnsavedChanges(session, state.document),
  );
  useEffect(() => {
    document.title = documentTitle(session.name, unsaved);
  }, [session.name, unsaved]);

  useEffect(() => {
    editor.setSettings({
      theme: canvasTheme,
      gateStyle: settings.gateStyle,
      showGrid: settings.showGrid,
      wheel: settings.wheel,
    });
  }, [editor, canvasTheme, settings.gateStyle, settings.showGrid, settings.wheel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => dispatchShortcut(commands, e, MAC);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commands]);

  useEffect(() => clipboard.attach(document), [clipboard]);

  // The Part tab follows the last part picked: a single part selected on the canvas…
  useEffect(() => {
    const follow = () => {
      const { selection, circuit, renames } = editor.state.get();
      // The Memory tab follows its memory through renames.
      const memory = ui.get().memoryPick;
      const renamed = memory === undefined ? undefined : renames?.get(memory);
      if (renamed !== undefined) ui.update((s) => ({ ...s, memoryPick: renamed }));
      if (selection.parts.size !== 1 || selection.wires.size !== 0) return;
      const [id] = selection.parts;
      const part = circuit.components.find((c) => c.id === id);
      const picked = part && memoryOfPart(editor, part.id);
      if (picked !== undefined && ui.get().memoryPick !== picked) {
        ui.update((s) => ({ ...s, memoryPick: picked }));
      }
      const current = ui.get().partPick;
      if (!part || (current?.id === part.id && current.type === part.type)) return;
      ui.update((s) => ({ ...s, partPick: { type: part.type, id: part.id } }));
    };
    follow();
    return editor.state.subscribe(follow);
  }, [editor, ui]);

  // Double-click on a part: show Properties and focus its designator.
  const request = useStore(editor.requests);
  useEffect(() => {
    if (request?.kind === 'edit-properties') commands.get('edit.properties').run();
    // Probing from the canvas shows the Waveforms tab (the tab shows a problem, if any); a watch
    // added from a module's Signals, the Debug tab.
    if (request?.kind === 'probed' || request?.kind === 'watched') {
      settingsStore.update((s) => ({
        ...s,
        bottomTab: request.kind === 'probed' ? 'waves' : 'debug',
        panels: { ...s.panels, bottom: { ...s.panels.bottom, visible: true } },
      }));
    }
    // A module's memory picked in its view (HDL-6): the Memory tab shows it.
    if (request?.kind === 'show-memory') {
      ui.update((s) => ({ ...s, memoryPick: request.ref }));
      settingsStore.update((s) => ({
        ...s,
        bottomTab: 'memory',
        panels: { ...s.panels, bottom: { ...s.panels.bottom, visible: true } },
      }));
    }
  }, [request, commands, settingsStore, ui]);

  // The Parts panel's parts: the library's and the document's circuits, except the circuits that
  // contain the open one (placing them would make it contain itself).
  const documentParts = useStoreValue(editor.state, (s) => s.design.registry);
  const openCircuit = useStoreValue(editor.state, (s) => s.circuit.id);
  const placeable = useMemo(
    () => placeableParts(documentParts, openCircuit),
    [documentParts, openCircuit],
  );

  const setPanel = (id: PanelId, change: Partial<Settings['panels'][PanelId]>) =>
    settingsStore.update((s) => ({
      ...s,
      panels: { ...s.panels, [id]: { ...s.panels[id], ...change } },
    }));
  const resize = (id: PanelId) => (size: number) => {
    const { min, max } = PANEL_LIMITS[id];
    setPanel(id, { size: Math.round(Math.min(max, Math.max(min, size))) });
  };
  const { circuits, parts, properties, bottom } = settings.panels;
  const leftDock = circuits.visible || parts.visible;
  const showTab = (bottomTab: BottomTab) =>
    settingsStore.update((s) => ({
      ...s,
      bottomTab,
      panels: { ...s.panels, bottom: { ...s.panels.bottom, visible: true } },
    }));
  const tab = settings.bottomTab;
  const closeDialog = () => ui.update(({ dialog: _, ...rest }) => rest);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a file drop target; File ▸ Open is the keyboard way
    <div
      className="workbench"
      // A .saltator.json file dropped anywhere opens (after "Save changes?").
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        const file = droppedFile(e.dataTransfer);
        if (file) void documents.openFile(() => file);
      }}
    >
      <MenuBar
        menus={menus}
        commands={commands}
        mac={MAC}
        trailing={
          <div className="menubar-document" data-testid="document-name" title={session.name}>
            {unsaved && (
              <span className="menubar-document-unsaved" title="Unsaved changes">
                •
              </span>
            )}
            <span className="menubar-document-name">{session.name}</span>
          </div>
        }
      />
      <Toolbar
        groups={TOOLBAR}
        commands={commands}
        mac={MAC}
        widgets={{ speed: <SpeedSelect simulation={editor.simulation} /> }}
      />
      <div className="workbench-main">
        {leftDock && (
          <>
            <div className="dock dock-left" style={{ width: parts.size }}>
              {circuits.visible && (
                <div
                  className={parts.visible ? 'dock-part' : 'dock-part fill'}
                  style={parts.visible ? { height: circuits.size } : undefined}
                >
                  <Panel
                    title="Circuits"
                    onClose={() => setPanel('circuits', { visible: false })}
                    testId="circuits-panel"
                  >
                    <CircuitsPanel editor={editor} commands={commands} mac={MAC} />
                  </Panel>
                </div>
              )}
              {circuits.visible && parts.visible && (
                <Splitter
                  orientation="horizontal"
                  size={circuits.size}
                  direction={1}
                  onResize={resize('circuits')}
                  label="Resize Circuits panel"
                />
              )}
              {parts.visible && (
                <div className="dock-part fill">
                  <Panel
                    title="Parts"
                    onClose={() => setPanel('parts', { visible: false })}
                    testId="parts-panel"
                  >
                    <PartsPanel
                      registry={placeable}
                      theme={canvasTheme}
                      gateStyle={settings.gateStyle}
                      searchRequest={uiState.searchRequest}
                      armed={typeof tool === 'object' ? tool.type : undefined}
                      onPick={(type) => {
                        // …or a part clicked in the Parts panel.
                        ui.update((s) => ({ ...s, partPick: { type } }));
                        editor.placePart(type);
                      }}
                      onDrag={(type) => editor.dragPart(type)}
                    />
                  </Panel>
                </div>
              )}
            </div>
            <Splitter
              orientation="vertical"
              size={parts.size}
              direction={1}
              onResize={resize('parts')}
              label="Resize Parts panel"
            />
          </>
        )}
        <CanvasHost editor={editor} commands={commands} drafts={drafts} />
        {properties.visible && (
          <>
            <Splitter
              orientation="vertical"
              size={properties.size}
              direction={-1}
              onResize={resize('properties')}
              label="Resize Properties panel"
            />
            <div className="dock dock-right" style={{ width: properties.size }}>
              <Panel
                title="Properties"
                onClose={() => setPanel('properties', { visible: false })}
                testId="properties-panel"
              >
                <PropertiesPanel editor={editor} focusRequest={uiState.propertiesRequest} />
              </Panel>
            </div>
          </>
        )}
      </div>
      {bottom.visible && (
        <>
          <Splitter
            orientation="horizontal"
            size={bottom.size}
            direction={-1}
            onResize={resize('bottom')}
            label="Resize bottom panel"
          />
          <div className="dock dock-bottom" style={{ height: bottom.size }}>
            <Panel
              title={
                <div className="dock-tabs" role="tablist" aria-label="Bottom panel">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'messages'}
                    className={tab === 'messages' ? 'tab active' : 'tab'}
                    onClick={() => showTab('messages')}
                  >
                    Messages
                    <MessagesBadges editor={editor} />
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'simulation'}
                    className={tab === 'simulation' ? 'tab active' : 'tab'}
                    onClick={() => showTab('simulation')}
                  >
                    Simulation
                    <SimulationBadges editor={editor} />
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'part'}
                    className={tab === 'part' ? 'tab active' : 'tab'}
                    onClick={() => showTab('part')}
                  >
                    Part
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'memory'}
                    className={tab === 'memory' ? 'tab active' : 'tab'}
                    onClick={() => showTab('memory')}
                  >
                    Memory
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'waves'}
                    className={tab === 'waves' ? 'tab active' : 'tab'}
                    onClick={() => showTab('waves')}
                  >
                    Waveforms
                    <WavesBadge editor={editor} />
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'debug'}
                    className={tab === 'debug' ? 'tab active' : 'tab'}
                    onClick={() => showTab('debug')}
                  >
                    Debug
                    <DebugBadge editor={editor} />
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'tests'}
                    className={tab === 'tests' ? 'tab active' : 'tab'}
                    onClick={() => showTab('tests')}
                  >
                    Tests
                    <TestsBadge editor={editor} tests={tests} />
                  </button>
                </div>
              }
              actions={
                tab === 'simulation' && (
                  <button
                    type="button"
                    className="icon-button"
                    title="Clear the list (problems that happen again come back)"
                    onClick={() => editor.simulation.clearDiagnostics()}
                  >
                    <Eraser size={13} />
                  </button>
                )
              }
              onClose={() => setPanel('bottom', { visible: false })}
              testId="bottom-panel"
            >
              {tab === 'messages' && <MessagesPanel editor={editor} />}
              {tab === 'simulation' && <SimulationPanel editor={editor} />}
              {tab === 'part' && (
                <PartInfoPanel
                  editor={editor}
                  pick={uiState.partPick}
                  theme={canvasTheme}
                  gateStyle={settings.gateStyle}
                />
              )}
              {tab === 'memory' && (
                <MemoryPanel
                  editor={editor}
                  pick={uiState.memoryPick}
                  onPick={(id) => ui.update((s) => ({ ...s, memoryPick: id }))}
                  follow={settings.memoryFollow}
                  onFollow={(memoryFollow) => settingsStore.update((s) => ({ ...s, memoryFollow }))}
                  actions={
                    images &&
                    ((entry) => (
                      <MemoryImageActions editor={editor} entry={entry} images={images} />
                    ))
                  }
                />
              )}
              {tab === 'waves' && (
                <WaveformsPanel
                  editor={editor}
                  theme={canvasTheme}
                  actions={
                    images && (
                      <VcdExportAction
                        editor={editor}
                        title={() => documents.session.get().name}
                        files={images}
                      />
                    )
                  }
                />
              )}
              {tab === 'debug' && (
                <DebugPanel
                  editor={editor}
                  runToRequest={uiState.runToRequest}
                  onEditBreakpoint={(breakpointDialog) =>
                    ui.update((s) => ({ ...s, breakpointDialog }))
                  }
                />
              )}
              {tab === 'tests' && (
                <TestsPanel
                  editor={editor}
                  tests={tests}
                  {...(images && { images })}
                  insertImageRequest={uiState.insertImageRequest === true}
                  onInsertImageAsked={() => ui.update(({ insertImageRequest: _, ...s }) => s)}
                />
              )}
            </Panel>
          </div>
        </>
      )}
      <StatusBar
        editor={editor}
        onShowMessages={() => showTab('messages')}
        onShowSimulation={() => showTab('simulation')}
      />
      {uiState.dialog === 'shortcuts' && (
        <ShortcutsDialog commands={commands} mac={MAC} onClose={closeDialog} />
      )}
      {uiState.dialog === 'about' && <AboutDialog onClose={closeDialog} />}
      {uiState.breakpointDialog && (
        <BreakpointDialog
          editor={editor}
          request={uiState.breakpointDialog}
          onClose={() => ui.update(({ breakpointDialog: _, ...rest }) => rest)}
        />
      )}
      {uiState.dialog === 'examples' && (
        <ExampleGalleryDialog
          examples={examples}
          registry={editor.registry}
          theme={canvasTheme}
          gateStyle={settings.gateStyle}
          onClose={closeDialog}
          onOpen={(example) => {
            closeDialog();
            void documents.openExample(example.label, example.document);
          }}
        />
      )}
      {uiState.unsavedQuestion && (
        <UnsavedChangesDialog
          name={uiState.unsavedQuestion.name}
          onAnswer={uiState.unsavedQuestion.answer}
        />
      )}
      {uiState.fileProblem && (
        <FileProblemDialog
          problem={uiState.fileProblem}
          onClose={() => ui.update(({ fileProblem: _, ...rest }) => rest)}
        />
      )}
      <ContextMenu editor={editor} commands={commands} mac={MAC} />
    </div>
  );
}

function CanvasHost({
  editor,
  commands,
  drafts,
}: {
  readonly editor: Editor;
  readonly commands: CommandRegistry;
  readonly drafts: ModuleDrafts;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // A Verilog module (HDL-1) has nothing to draw: its view covers the canvas while it is open.
  const verilog = useStoreValue(editor.state, (state) =>
    state.circuit.verilog ? state.circuit.id : undefined,
  );
  useEffect(() => editor.mount(canvas.current!), [editor]);
  const dragged = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(PART_DRAG_TYPE) ? editor.draggedPart : undefined;
  return (
    <div
      className="canvas-host"
      role="application"
      aria-label="Schematic editor"
      onDragOver={(e) => {
        const type = dragged(e);
        if (!type) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        editor.dragPart(type, [e.clientX, e.clientY]);
      }}
      onDragLeave={(e) => {
        if (dragged(e) && !e.currentTarget.contains(e.relatedTarget as Node)) {
          editor.dragPart(editor.draggedPart);
        }
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(PART_DRAG_TYPE) || dragged(e);
        if (!type) return;
        e.preventDefault();
        editor.dropPart(type, [e.clientX, e.clientY]);
        canvas.current?.focus({ preventScroll: true });
      }}
    >
      <canvas ref={canvas} tabIndex={0} aria-label="Schematic" data-testid="schematic" />
      {verilog !== undefined && <ModuleView key={verilog} editor={editor} drafts={drafts} />}
      <Breadcrumbs editor={editor} commands={commands} mac={MAC} />
    </div>
  );
}
