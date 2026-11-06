/** The commands of the workbench and where they appear: menus and toolbar. */
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  FilePlus,
  FlipHorizontal2,
  FlipVertical2,
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
import { type Circuit, emptyCircuit } from '../circuit';
import { ALL_SPEEDS, type Editor, EMPTY_SELECTION, type Store } from '../editor';
import type { ClipboardBridge } from './clipboard';
import type { Command } from './commands';
import { GateIcon, WireIcon } from './icons';
import type { PanelId, Settings, ThemeSetting } from './settings';
import type { Example, UiState } from './ui-state';

export interface WorkbenchContext {
  readonly editor: Editor;
  readonly clipboard: ClipboardBridge;
  readonly settings: Store<Settings>;
  readonly ui: Store<UiState>;
  readonly examples: readonly Example[];
}

const PANEL_LABELS: Readonly<Record<PanelId, string>> = {
  parts: 'Parts',
  properties: 'Properties',
  bottom: 'Messages',
};

const THEME_LABELS: Readonly<Record<ThemeSetting, string>> = {
  system: 'Follow System',
  dark: 'Dark',
  light: 'Light',
};

const THEME_ICONS = { system: Monitor, dark: Moon, light: Sun } as const;

export function createCommands({
  editor,
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

  // Until R07 brings files, opening a document is an undoable edit: nothing is lost by accident.
  // A running simulation stops first: the new document's U1 is not the old one's.
  const open = (label: string, circuit: Circuit) => {
    editor.simulation.stop();
    editor.edit(label, circuit, { selection: EMPTY_SELECTION, fit: true });
  };
  const simulation = editor.simulation;
  const simState = () => simulation.state;

  return [
    {
      id: 'file.new',
      label: 'New Circuit',
      icon: FilePlus,
      run: () => open('New Circuit', emptyCircuit()),
    },
    ...examples.map(
      (example): Command => ({
        id: `file.example.${example.id}`,
        label: example.label,
        run: () => open(`Open ${example.label}`, example.circuit()),
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

export function workbenchMenus(examples: readonly Example[]): MenuDef[] {
  return [
    {
      label: 'File',
      items: [
        'file.new',
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
