/** The commands of the workbench and where they appear: menus and toolbar. */
import {
  BookOpen,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FileDown,
  FilePlus,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Grid3x3,
  Hand,
  Info,
  Keyboard,
  Maximize,
  Monitor,
  Moon,
  MousePointer2,
  Pause,
  Play,
  Pointer,
  Redo2,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Scissors,
  Search,
  SlidersHorizontal,
  Square,
  StepForward,
  Sun,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ALL_SPEEDS, type Editor, type Store } from '../editor';
import type { ClipboardBridge } from './clipboard';
import type { Command } from './commands';
import type { DocumentController } from './document-controller';
import { GateIcon, WireIcon } from './icons';
import { RECENT_LIMIT, type RecentFiles } from './recent-files';
import type { PanelId, Settings, ThemeSetting } from './settings';
import type { Example, UiState } from './ui-state';

export interface WorkbenchContext {
  readonly editor: Editor;
  readonly documents: DocumentController;
  /** File ▸ Open Recent; none without file handles (Firefox, Safari). */
  readonly recent?: RecentFiles;
  readonly clipboard: ClipboardBridge;
  readonly settings: Store<Settings>;
  readonly ui: Store<UiState>;
  readonly examples: readonly Example[];
}

const PANEL_LABELS: Readonly<Record<PanelId, string>> = {
  parts: 'Parts',
  properties: 'Properties',
  bottom: 'Messages and Simulation',
};

const THEME_LABELS: Readonly<Record<ThemeSetting, string>> = {
  system: 'Follow System',
  dark: 'Dark',
  light: 'Light',
};

const THEME_ICONS = { system: Monitor, dark: Moon, light: Sun } as const;

export function createCommands({
  editor,
  documents,
  recent,
  clipboard,
  settings,
  ui,
  examples,
}: WorkbenchContext): Command[] {
  const patch = (change: Partial<Settings>) => settings.update((s) => ({ ...s, ...change }));
  const setPanel = (id: PanelId, visible: boolean) =>
    settings.update((s) => ({
      ...s,
      panels: { ...s.panels, [id]: { ...s.panels[id], visible } },
    }));

  const simulation = editor.simulation;
  const simState = () => simulation.state;

  return [
    // File commands ask before replacing unsaved changes (DocumentController). Mod+N belongs to
    // Chrome (a new window) and never reaches the page. The keys are global: the browser's own
    // Save Page and Open File must not show up, even while typing in a field.
    {
      id: 'file.new',
      label: 'New Circuit',
      icon: FilePlus,
      shortcuts: ['Mod+Alt+N'],
      run: () => void documents.newDocument(),
    },
    {
      id: 'file.open',
      label: 'Open…',
      icon: FolderOpen,
      shortcuts: ['Mod+O'],
      global: true,
      run: () => void documents.open(),
    },
    {
      id: 'file.save',
      label: 'Save',
      icon: FileDown,
      shortcuts: ['Mod+S'],
      global: true,
      run: () => void documents.save(),
    },
    {
      id: 'file.saveAs',
      label: 'Save As…',
      shortcuts: ['Mod+Shift+S'],
      global: true,
      run: () => void documents.saveAs(),
    },
    ...Array.from(
      { length: RECENT_LIMIT },
      (_, i): Command => ({
        id: `file.recent.${i}`,
        label: `Recent File ${i + 1}`,
        menuLabel: () => recent?.list.get()[i]?.name ?? '',
        enabled: () => recent?.list.get()[i] !== undefined,
        run: () => {
          const file = recent?.list.get()[i];
          if (recent && file) void documents.openFile(() => recent.read(file, documents.files));
        },
      }),
    ),
    {
      id: 'file.recent.none',
      label: 'No Recent Files',
      enabled: () => false,
      run: () => {},
    },
    {
      id: 'file.recent.clear',
      label: 'Clear Recent Files',
      enabled: () => (recent?.list.get().length ?? 0) > 0,
      run: () => void recent?.clear(),
    },
    ...examples.map(
      (example): Command => ({
        id: `file.example.${example.id}`,
        label: example.label,
        run: () => void documents.openExample(example.label, example.document),
      }),
    ),

    {
      id: 'edit.undo',
      label: 'Undo',
      menuLabel: () => (editor.undoLabel ? `Undo ${editor.undoLabel}` : 'Undo'),
      icon: Undo2,
      shortcuts: ['Mod+Z'],
      enabled: () => editor.undoLabel !== undefined,
      run: () => editor.undo(),
    },
    {
      id: 'edit.redo',
      label: 'Redo',
      menuLabel: () => (editor.redoLabel ? `Redo ${editor.redoLabel}` : 'Redo'),
      icon: Redo2,
      shortcuts: ['Mod+Shift+Z', 'Mod+Y'],
      enabled: () => editor.redoLabel !== undefined,
      run: () => editor.redo(),
    },

    {
      id: 'edit.cut',
      label: 'Cut',
      icon: Scissors,
      shortcuts: ['Mod+X'],
      nativeKeys: true,
      enabled: () => editor.hasSelection,
      run: () => clipboard.cut(),
    },
    {
      id: 'edit.copy',
      label: 'Copy',
      icon: Copy,
      shortcuts: ['Mod+C'],
      nativeKeys: true,
      enabled: () => editor.hasSelection,
      run: () => clipboard.copy(),
    },
    {
      id: 'edit.paste',
      label: 'Paste',
      icon: ClipboardPaste,
      shortcuts: ['Mod+V'],
      nativeKeys: true,
      run: () => {
        void clipboard.paste();
      },
    },
    {
      id: 'edit.duplicate',
      label: 'Duplicate',
      icon: CopyPlus,
      shortcuts: ['Mod+D'],
      enabled: () => editor.hasSelection,
      run: () => editor.duplicate(),
    },
    {
      id: 'edit.properties',
      label: 'Properties…',
      icon: SlidersHorizontal,
      enabled: () => editor.state.get().selection.parts.size === 1,
      run: () => {
        setPanel('properties', true);
        ui.update((s) => ({ ...s, propertiesRequest: s.propertiesRequest + 1 }));
      },
    },
    {
      id: 'edit.partInfo',
      label: 'Part Info',
      icon: BookOpen,
      enabled: () => editor.state.get().selection.parts.size === 1,
      run: () =>
        settings.update((s) => ({
          ...s,
          bottomTab: 'part',
          panels: { ...s.panels, bottom: { ...s.panels.bottom, visible: true } },
        })),
    },
    {
      id: 'edit.delete',
      label: 'Delete',
      icon: Trash2,
      shortcuts: ['Delete', 'Backspace'],
      enabled: () => editor.hasSelection,
      run: () => editor.deleteSelection(),
    },
    {
      id: 'edit.rotate',
      label: 'Rotate',
      title: 'Rotate clockwise',
      icon: RotateCw,
      shortcuts: ['R'],
      enabled: () => editor.hasSelection,
      run: () => editor.rotate(true),
    },
    {
      id: 'edit.rotateCcw',
      label: 'Rotate Counter-clockwise',
      icon: RotateCcw,
      shortcuts: ['Shift+R'],
      enabled: () => editor.hasSelection,
      run: () => editor.rotate(false),
    },
    {
      id: 'edit.flipH',
      label: 'Flip Horizontal',
      icon: FlipHorizontal2,
      shortcuts: ['F'],
      enabled: () => editor.hasSelection,
      run: () => editor.flip('horizontal'),
    },
    {
      id: 'edit.flipV',
      label: 'Flip Vertical',
      icon: FlipVertical2,
      shortcuts: ['Shift+F'],
      enabled: () => editor.hasSelection,
      run: () => editor.flip('vertical'),
    },
    ...(
      [
        ['Left', 'ArrowLeft', -1, 0],
        ['Right', 'ArrowRight', 1, 0],
        ['Up', 'ArrowUp', 0, -1],
        ['Down', 'ArrowDown', 0, 1],
      ] as const
    ).map(
      ([name, key, dx, dy]): Command => ({
        id: `edit.nudge${name}`,
        label: `Nudge ${name} (Shift: 10 cells)`,
        shortcuts: [key, `Shift+${key}`],
        enabled: () => editor.hasSelection,
        run: (event) => {
          const step = event?.shiftKey ? 10 : 1;
          editor.nudge(dx * step, dy * step);
        },
      }),
    ),
    {
      id: 'edit.selectAll',
      label: 'Select All',
      shortcuts: ['Mod+A'],
      run: () => editor.selectAll(),
    },
    {
      id: 'edit.deselect',
      label: 'Deselect',
      shortcuts: ['Escape'],
      run: () => editor.escape(),
    },

    {
      id: 'tool.select',
      label: 'Select',
      title: 'Select',
      icon: MousePointer2,
      shortcuts: ['V'],
      checked: () => editor.tool.get() === 'select',
      run: () => editor.setTool('select'),
    },
    {
      id: 'tool.pan',
      label: 'Pan',
      title: 'Pan (or drag with Space / middle button)',
      icon: Hand,
      shortcuts: ['H'],
      checked: () => editor.tool.get() === 'pan',
      run: () => editor.setTool('pan'),
    },

    {
      id: 'tool.wire',
      label: 'Wire',
      title: 'Draw wires',
      icon: WireIcon,
      shortcuts: ['W'],
      checked: () => editor.tool.get() === 'wire',
      run: () => editor.setTool('wire'),
    },

    {
      id: 'tool.interact',
      label: 'Interact',
      title: 'Operate switches and buttons while simulating',
      icon: Pointer,
      shortcuts: ['I'],
      checked: () => editor.tool.get() === 'interact',
      run: () => editor.setTool('interact'),
    },

    {
      id: 'sim.toggle',
      label: 'Run / Pause',
      menuLabel: () =>
        simState() === 'running' ? 'Pause' : simState() === 'paused' ? 'Continue' : 'Run',
      icon: Play,
      stateIcon: () => (simState() === 'running' ? Pause : Play),
      shortcuts: ['F5'],
      global: true,
      enabled: () => simState() !== 'halted',
      run: () => simulation.toggle(),
    },
    {
      id: 'sim.step',
      label: 'Step',
      title: 'Step to the next event',
      icon: StepForward,
      shortcuts: ['F10'],
      global: true,
      enabled: () => simState() === 'stopped' || simState() === 'paused',
      run: () => {
        simulation.step();
      },
    },
    {
      id: 'sim.stop',
      label: 'Stop',
      title: 'Stop the simulation',
      icon: Square,
      shortcuts: ['Shift+F5'],
      global: true,
      enabled: () => simState() !== 'stopped',
      run: () => simulation.stop(),
    },
    {
      id: 'sim.reset',
      label: 'Reset',
      title: 'Reset: power on again at t = 0',
      icon: RefreshCcw,
      shortcuts: ['Mod+Shift+F5'],
      global: true,
      enabled: () => simState() !== 'stopped',
      run: () => simulation.reset(),
    },
    ...ALL_SPEEDS.map(
      (speed): Command => ({
        id: `sim.speed.${speed.id}`,
        label: speed.label,
        checked: () => simulation.status.get().speed.id === speed.id,
        run: () => simulation.setSpeed(speed),
      }),
    ),

    {
      id: 'view.zoomIn',
      label: 'Zoom In',
      icon: ZoomIn,
      shortcuts: ['Mod+=', 'Mod++', '=', '+'],
      run: () => editor.zoomIn(),
    },
    {
      id: 'view.zoomOut',
      label: 'Zoom Out',
      icon: ZoomOut,
      shortcuts: ['Mod+-', '-'],
      run: () => editor.zoomOut(),
    },
    {
      id: 'view.zoomFit',
      label: 'Zoom to Fit',
      icon: Maximize,
      shortcuts: ['Mod+0', 'Home'],
      run: () => editor.zoomToFit(),
    },
    {
      id: 'view.zoom100',
      label: 'Actual Size',
      title: 'Actual size (100 %)',
      shortcuts: ['Mod+1'],
      run: () => editor.zoomActual(),
    },
    {
      id: 'view.grid',
      label: 'Show Grid',
      icon: Grid3x3,
      shortcuts: ['Shift+G'],
      checked: () => settings.get().showGrid,
      run: () => patch({ showGrid: !settings.get().showGrid }),
    },

    ...(['system', 'dark', 'light'] as const).map(
      (theme): Command => ({
        id: `view.theme.${theme}`,
        label: THEME_LABELS[theme],
        icon: THEME_ICONS[theme],
        checked: () => settings.get().theme === theme,
        run: () => patch({ theme }),
      }),
    ),

    {
      id: 'view.gates.ansi',
      label: 'ANSI (Distinctive Shapes)',
      checked: () => settings.get().gateStyle === 'ansi',
      run: () => patch({ gateStyle: 'ansi' }),
    },
    {
      id: 'view.gates.iec',
      label: 'IEC (Rectangles)',
      checked: () => settings.get().gateStyle === 'iec',
      run: () => patch({ gateStyle: 'iec' }),
    },
    {
      id: 'view.gates.toggle',
      label: 'Toggle Gate Style',
      title: 'Gate style: ANSI / IEC',
      icon: GateIcon,
      shortcuts: ['Shift+I'],
      checked: () => settings.get().gateStyle === 'iec',
      run: () => patch({ gateStyle: settings.get().gateStyle === 'ansi' ? 'iec' : 'ansi' }),
    },

    {
      id: 'view.wheel.pan',
      label: 'Scroll Pans, Pinch Zooms (Figma)',
      checked: () => settings.get().wheel === 'pan',
      run: () => patch({ wheel: 'pan' }),
    },
    {
      id: 'view.wheel.zoom',
      label: 'Scroll Wheel Zooms (KiCad)',
      checked: () => settings.get().wheel === 'zoom',
      run: () => patch({ wheel: 'zoom' }),
    },

    ...(['parts', 'properties', 'bottom'] as const).map(
      (id): Command => ({
        id: `view.panel.${id}`,
        label: PANEL_LABELS[id],
        checked: () => settings.get().panels[id].visible,
        run: () => setPanel(id, !settings.get().panels[id].visible),
      }),
    ),

    {
      id: 'parts.search',
      label: 'Find Part…',
      icon: Search,
      shortcuts: ['/', 'Mod+F'],
      run: () => {
        setPanel('parts', true);
        ui.update((s) => ({ ...s, searchRequest: s.searchRequest + 1 }));
      },
    },

    {
      id: 'help.shortcuts',
      label: 'Keyboard Shortcuts',
      icon: Keyboard,
      shortcuts: ['?', 'Mod+/'],
      run: () => ui.update((s) => ({ ...s, dialog: 'shortcuts' })),
    },
    {
      id: 'help.about',
      label: 'About Logic',
      icon: Info,
      run: () => ui.update((s) => ({ ...s, dialog: 'about' })),
    },
  ];
}

/** A menu item: a command id, a separator, or a submenu. */
export type MenuEntry =
  | string
  | { readonly separator: true }
  | { readonly label: string; readonly items: readonly MenuEntry[] };

export interface MenuDef {
  readonly label: string;
  readonly items: readonly MenuEntry[];
}

const SEPARATOR = { separator: true } as const;

/**
 * The menu bar. `recentCount`: how many files File ▸ Open Recent lists; `undefined` hides it
 * (no file handles in this browser).
 */
export function workbenchMenus(examples: readonly Example[], recentCount?: number): MenuDef[] {
  const recentItems: MenuEntry[] =
    recentCount === undefined
      ? []
      : [
          {
            label: 'Open Recent',
            items:
              recentCount === 0
                ? ['file.recent.none']
                : [
                    ...Array.from({ length: recentCount }, (_, i) => `file.recent.${i}`),
                    SEPARATOR,
                    'file.recent.clear',
                  ],
          },
        ];
  return [
    {
      label: 'File',
      items: [
        'file.new',
        'file.open',
        ...recentItems,
        SEPARATOR,
        'file.save',
        'file.saveAs',
        SEPARATOR,
        { label: 'Examples', items: examples.map((e) => `file.example.${e.id}`) },
      ],
    },
    {
      label: 'Edit',
      items: [
        'edit.undo',
        'edit.redo',
        SEPARATOR,
        'edit.cut',
        'edit.copy',
        'edit.paste',
        'edit.duplicate',
        'edit.delete',
        SEPARATOR,
        'edit.rotate',
        'edit.rotateCcw',
        'edit.flipH',
        'edit.flipV',
        SEPARATOR,
        'edit.selectAll',
        'edit.deselect',
        SEPARATOR,
        'edit.properties',
        'edit.partInfo',
        'parts.search',
      ],
    },
    { label: 'Place', items: ['tool.wire', 'parts.search'] },
    {
      label: 'View',
      items: [
        'view.zoomIn',
        'view.zoomOut',
        'view.zoomFit',
        'view.zoom100',
        SEPARATOR,
        'tool.select',
        'tool.pan',
        'tool.wire',
        'tool.interact',
        SEPARATOR,
        'view.grid',
        { label: 'Theme', items: ['view.theme.system', 'view.theme.dark', 'view.theme.light'] },
        { label: 'Gate Style', items: ['view.gates.ansi', 'view.gates.iec'] },
        { label: 'Scroll Wheel', items: ['view.wheel.pan', 'view.wheel.zoom'] },
        SEPARATOR,
        {
          label: 'Panels',
          items: ['view.panel.parts', 'view.panel.properties', 'view.panel.bottom'],
        },
      ],
    },
    {
      label: 'Simulate',
      items: [
        'sim.toggle',
        'sim.step',
        'sim.stop',
        'sim.reset',
        SEPARATOR,
        { label: 'Speed', items: ALL_SPEEDS.map((s) => `sim.speed.${s.id}`) },
        SEPARATOR,
        'tool.interact',
      ],
    },
    { label: 'Help', items: ['help.shortcuts', SEPARATOR, 'help.about'] },
  ];
}

/** The context menu over a part or wire, and over empty canvas. */
export const ITEM_CONTEXT_MENU: readonly MenuEntry[] = [
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.duplicate',
  'edit.delete',
  SEPARATOR,
  'edit.rotate',
  'edit.rotateCcw',
  'edit.flipH',
  'edit.flipV',
  SEPARATOR,
  'edit.properties',
  'edit.partInfo',
];

export const CANVAS_CONTEXT_MENU: readonly MenuEntry[] = [
  'edit.paste',
  SEPARATOR,
  'edit.selectAll',
  'view.zoomFit',
];

/** Toolbar groups, separated by dividers. */
export const TOOLBAR: readonly (readonly string[])[] = [
  ['tool.select', 'tool.pan', 'tool.wire', 'tool.interact'],
  ['edit.undo', 'edit.redo'],
  ['edit.rotate', 'edit.flipH', 'edit.delete'],
  ['sim.toggle', 'sim.step', 'sim.stop', 'sim.reset', 'widget:speed'],
  ['view.zoomIn', 'view.zoomOut', 'view.zoomFit'],
  ['view.grid', 'view.gates.toggle'],
];
