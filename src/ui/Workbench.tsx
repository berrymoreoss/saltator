import { useEffect, useMemo, useRef } from 'react';
import { DARK_CANVAS, type Editor, LIGHT_CANVAS, type Store } from '../editor';
import { CommandRegistry, dispatchShortcut } from './commands';
import { useMediaQuery, useStore } from './hooks';
import { MenuBar } from './MenuBar';
import { Panel, Splitter } from './Panel';
import { StatusBar } from './StatusBar';
import { effectiveTheme, PANEL_LIMITS, type PanelId, type Settings } from './settings';
import { isMacPlatform } from './shortcuts';
import { Toolbar } from './Toolbar';
import type { Example, UiState } from './ui-state';
import { createCommands, TOOLBAR, workbenchMenus } from './workbench-commands';
import './styles/tokens.css';
import './styles/workbench.css';

export interface WorkbenchProps {
  readonly editor: Editor;
  readonly settings: Store<Settings>;
  readonly ui: Store<UiState>;
  readonly examples: readonly Example[];
}

const MAC = typeof navigator !== 'undefined' && isMacPlatform(navigator.platform);

/**
 * The desktop CAD-style shell: menu bar, toolbar, Parts dock (left), canvas, Properties dock
 * (right), bottom dock with tabs, status bar. Spec: docs/editor.md#shell.
 */
export function Workbench({ editor, settings: settingsStore, ui, examples }: WorkbenchProps) {
  const settings = useStore(settingsStore);
  // Toolbar and menus read the tool and settings through their commands: re-render on change.
  useStore(editor.tool);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = effectiveTheme(settings.theme, prefersDark);

  const commands = useMemo(
    () => new CommandRegistry(createCommands({ editor, settings: settingsStore, ui, examples })),
    [editor, settingsStore, ui, examples],
  );
  const menus = useMemo(() => workbenchMenus(examples), [examples]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    editor.setSettings({
      theme: theme === 'dark' ? DARK_CANVAS : LIGHT_CANVAS,
      gateStyle: settings.gateStyle,
      showGrid: settings.showGrid,
      wheel: settings.wheel,
    });
  }, [editor, theme, settings.gateStyle, settings.showGrid, settings.wheel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => dispatchShortcut(commands, e, MAC);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commands]);

  const setPanel = (id: PanelId, change: Partial<Settings['panels'][PanelId]>) =>
    settingsStore.update((s) => ({
      ...s,
      panels: { ...s.panels, [id]: { ...s.panels[id], ...change } },
    }));
  const resize = (id: PanelId) => (size: number) => {
    const { min, max } = PANEL_LIMITS[id];
    setPanel(id, { size: Math.round(Math.min(max, Math.max(min, size))) });
  };
  const { parts, properties, bottom } = settings.panels;

  return (
    <div className="workbench">
      <MenuBar menus={menus} commands={commands} mac={MAC} />
      <Toolbar groups={TOOLBAR} commands={commands} mac={MAC} />
      <div className="workbench-main">
        {parts.visible && (
          <>
            <div className="dock dock-left" style={{ width: parts.size }}>
              <Panel
                title="Parts"
                onClose={() => setPanel('parts', { visible: false })}
                testId="parts-panel"
              >
                {null}
              </Panel>
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
        <CanvasHost editor={editor} />
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
                {null}
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
              title={<span className="tab active">Messages</span>}
              onClose={() => setPanel('bottom', { visible: false })}
              testId="bottom-panel"
            >
              {null}
            </Panel>
          </div>
        </>
      )}
      <StatusBar editor={editor} onShowMessages={() => setPanel('bottom', { visible: true })} />
    </div>
  );
}

function CanvasHost({ editor }: { readonly editor: Editor }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => editor.mount(canvas.current!), [editor]);
  return (
    <div className="canvas-host">
      <canvas ref={canvas} tabIndex={0} aria-label="Schematic" data-testid="schematic" />
    </div>
  );
}
