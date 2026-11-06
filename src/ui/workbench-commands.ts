/**
 * The commands of the workbench and where they appear: menus and toolbar. R05 adds a Simulate
 * menu.
 */
import {
  FilePlus,
  Grid3x3,
  Hand,
  Info,
  Keyboard,
  Maximize,
  Monitor,
  Moon,
  MousePointer2,
  Redo2,
  Search,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { type Circuit, emptyCircuit } from '../circuit';
import { type Editor, EMPTY_SELECTION, type Store } from '../editor';
import type { Command } from './commands';
import { GateIcon } from './icons';
import type { PanelId, Settings, ThemeSetting } from './settings';
import type { Example, UiState } from './ui-state';

export interface WorkbenchContext {
  readonly editor: Editor;
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

export function createCommands({ editor, settings, ui, examples }: WorkbenchContext): Command[] {
  const patch = (change: Partial<Settings>) => settings.update((s) => ({ ...s, ...change }));
  const setPanel = (id: PanelId, visible: boolean) =>
    settings.update((s) => ({
      ...s,
      panels: { ...s.panels, [id]: { ...s.panels[id], visible } },
    }));

  // Until R07 brings files, opening a document is an undoable edit: nothing is lost by accident.
  const open = (label: string, circuit: Circuit) =>
    editor.edit(label, circuit, { selection: EMPTY_SELECTION, fit: true });

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
      id: 'edit.selectAll',
      label: 'Select All',
      shortcuts: ['Mod+A'],
      run: () => editor.selectAll(),
    },
    {
      id: 'edit.deselect',
      label: 'Deselect',
      shortcuts: ['Escape'],
      run: () => {
        editor.clearSelection();
        editor.setTool('select');
      },
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
        'edit.selectAll',
        'edit.deselect',
        SEPARATOR,
        'parts.search',
      ],
    },
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
    { label: 'Help', items: ['help.shortcuts', SEPARATOR, 'help.about'] },
  ];
}

/** Toolbar groups, separated by dividers. */
export const TOOLBAR: readonly (readonly string[])[] = [
  ['tool.select', 'tool.pan'],
  ['edit.undo', 'edit.redo'],
  ['view.zoomIn', 'view.zoomOut', 'view.zoomFit'],
  ['view.grid', 'view.gates.toggle'],
];
