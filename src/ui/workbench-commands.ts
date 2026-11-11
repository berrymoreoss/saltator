/** The commands of the workbench and where they appear: menus and toolbar. */
import {
  Activity,
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  CircleDot,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  FastForward,
  FileCode,
  FileDown,
  FilePlus,
  FlaskConical,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Grid3x3,
  Hand,
  Hourglass,
  Info,
  Keyboard,
  LayoutGrid,
  Maximize,
  MemoryStick,
  Monitor,
  Moon,
  MousePointer2,
  Pause,
  Play,
  Pointer,
  Redo2,
  RefreshCcw,
  Rewind,
  RotateCcw,
  RotateCw,
  Scissors,
  Search,
  SkipForward,
  SlidersHorizontal,
  Square,
  StepBack,
  StepForward,
  Sun,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  addCircuit,
  type CircuitDocument,
  circuitUses,
  duplicateCircuit,
  MODULE_PART,
  removeCircuit,
  setTopCircuit,
  subcircuitOf,
} from '../circuit';
import { formatTime, isBusName } from '../core';
import { ALL_SPEEDS, type Editor, type Store } from '../editor';
import type { ClipboardBridge } from './clipboard';
import type { Command } from './commands';
import type { DocumentController } from './document-controller';
import { APP_NAME } from './document-session';
import { BusIcon, GateIcon, WireIcon } from './icons';
import { RECENT_LIMIT, type RecentFiles } from './recent-files';
import type { PanelId, Settings, ThemeSetting } from './settings';
import type { TestSession } from './test-session';
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
  /** The test benches (R15b); none: the Test menu's commands are off. */
  readonly tests?: TestSession;
}

const PANEL_LABELS: Readonly<Record<PanelId, string>> = {
  circuits: 'Circuits',
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
  tests,
}: WorkbenchContext): Command[] {
  const patch = (change: Partial<Settings>) => settings.update((s) => ({ ...s, ...change }));
  const setPanel = (id: PanelId, visible: boolean) =>
    settings.update((s) => ({
      ...s,
      panels: { ...s.panels, [id]: { ...s.panels[id], visible } },
    }));

  const simulation = editor.simulation;
  const simState = () => simulation.state;
  const showDebug = () =>
    settings.update((s) => ({
      ...s,
      bottomTab: 'debug',
      panels: { ...s.panels, bottom: { ...s.panels.bottom, visible: true } },
    }));
  const showTests = () =>
    settings.update((s) => ({
      ...s,
      bottomTab: 'tests',
      panels: { ...s.panels, bottom: { ...s.panels.bottom, visible: true } },
    }));
  /** The single signal under the context menu (a pin or a net, not a bus). */
  const oneBit = () => {
    const spot = editor.contextProbe;
    return spot && !isBusName(spot.ref) ? spot.ref : undefined;
  };
  /** The designator of the instance selected alone on the canvas, if a subcircuit instance is. */
  const selectedInstance = () => {
    const { selection, circuit } = editor.state.get();
    if (selection.parts.size !== 1) return undefined;
    const [id] = selection.parts;
    const part = circuit.components.find((c) => c.id === id);
    return part && subcircuitOf(part.type) !== undefined ? part.id : undefined;
  };
  /** Where Go Up goes: `Main`, `A2 (Chain)`; undefined at the top or placed nowhere. */
  const parentOf = () => {
    const { path, design, document } = editor.state.get();
    if (!path) return undefined;
    const slash = path.lastIndexOf('/');
    if (slash < 0) return document.circuits[0]!.name;
    const parent = path.slice(0, slash);
    const circuit = document.circuits.find((c) => c.id === design.circuitAt(parent));
    return `${parent} (${circuit?.name ?? '?'})`;
  };
  /** Shows the open circuit's name in Properties, ready to type. */
  const focusCircuitName = () => {
    setPanel('properties', true);
    ui.update((s) => ({ ...s, propertiesRequest: s.propertiesRequest + 1 }));
  };
  /** The memory of the part selected alone on the canvas, if any. */
  const selectedMemory = () => {
    const { selection } = editor.state.get();
    if (selection.parts.size !== 1) return undefined;
    const [id] = selection.parts;
    return memoryOfPart(editor, id!);
  };

  return [
    // File commands ask before replacing unsaved changes (DocumentController). Mod+N belongs to
    // Chrome (a new window) and never reaches the page. The keys are global: the browser's own
    // Save Page and Open File must not show up, even while typing in a field.
    {
      id: 'file.new',
      label: 'New Document',
      icon: FilePlus,
      shortcuts: ['Mod+Alt+N'],
      run: () => void documents.newDocument(),
    },
    // Circuits of the document (R11a): they act on the circuit open.
    {
      id: 'circuit.add',
      label: 'Add Circuit',
      icon: FilePlus,
      run: () => {
        const { document } = editor.state.get();
        const { document: next, id } = addCircuit(document, freeCircuitName(document));
        editor.editDocument('Add Circuit', next, { open: id });
        focusCircuitName();
      },
    },
    {
      id: 'circuit.addVerilog',
      label: 'Add Verilog Module',
      icon: FileCode,
      run: () => {
        const { document } = editor.state.get();
        const { document: next, id } = addCircuit(document, freeModuleName(document), {
          verilog: true,
        });
        editor.editDocument('Add Verilog Module', next, { open: id });
      },
    },
    {
      id: 'circuit.rename',
      label: 'Rename Circuit…',
      run: () => {
        editor.clearSelection();
        focusCircuitName();
      },
    },
    {
      id: 'circuit.duplicate',
      label: 'Duplicate Circuit',
      run: () => {
        const { document, circuit } = editor.state.get();
        const { document: next, id } = duplicateCircuit(document, circuit.id);
        editor.editDocument(`Duplicate ${circuit.name}`, next, { open: id });
      },
    },
    {
      id: 'circuit.delete',
      label: 'Delete Circuit',
      menuLabel: () => {
        const { document, circuit } = editor.state.get();
        const count = circuitUses(document, circuit.id).reduce(
          (n, u) => n + u.components.length,
          0,
        );
        return count === 0
          ? 'Delete Circuit'
          : `Delete Circuit and ${count} Instance${count === 1 ? '' : 's'}`;
      },
      enabled: () => editor.state.get().document.circuits.length > 1,
      run: () => {
        const { document, circuit } = editor.state.get();
        const next = removeCircuit(document, circuit.id);
        editor.editDocument(`Delete ${circuit.name}`, next, { open: next.circuits[0]!.id });
      },
    },
    {
      id: 'circuit.setTop',
      label: 'Set as Top Circuit',
      enabled: () => {
        const { circuit, design } = editor.state.get();
        return circuit.id !== design.top;
      },
      run: () => {
        const { document, circuit } = editor.state.get();
        editor.editDocument(`Set ${circuit.name} as Top`, setTopCircuit(document, circuit.id));
      },
    },
    {
      id: 'circuit.goInto',
      label: 'Go Into Instance',
      menuLabel: () => {
        const id = selectedInstance();
        return id === undefined ? 'Go Into Instance' : `Go Into ${id}`;
      },
      shortcuts: ['Mod+ArrowDown'],
      enabled: () => selectedInstance() !== undefined,
      run: () => {
        const id = selectedInstance();
        if (id !== undefined) editor.goInto(id);
      },
    },
    {
      id: 'circuit.goUp',
      label: 'Go Up',
      menuLabel: () => {
        const parent = parentOf();
        return parent === undefined ? 'Go Up' : `Go Up to ${parent}`;
      },
      shortcuts: ['Mod+ArrowUp'],
      enabled: () => parentOf() !== undefined,
      run: () => editor.goUp(),
    },
    {
      id: 'circuit.goTop',
      label: 'Go to Top Circuit',
      enabled: () => {
        const { circuit, design } = editor.state.get();
        return circuit.id !== design.top;
      },
      run: () => editor.goTop(),
    },
    {
      id: 'file.gallery',
      label: 'New from Example…',
      icon: LayoutGrid,
      run: () => ui.update((s) => ({ ...s, dialog: 'examples' })),
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
      id: 'edit.inspectMemory',
      label: 'Inspect Memory',
      icon: MemoryStick,
      enabled: () => selectedMemory() !== undefined,
      run: () => {
        const id = selectedMemory();
        if (id === undefined) return;
        ui.update((s) => ({ ...s, memoryPick: id }));
        settings.update((s) => ({
          ...s,
          bottomTab: 'memory',
          panels: { ...s.panels, bottom: { ...s.panels.bottom, visible: true } },
        }));
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
      id: 'tool.bus',
      label: 'Bus',
      title: 'Draw bus lines',
      icon: BusIcon,
      shortcuts: ['B'],
      checked: () => editor.tool.get() === 'bus',
      run: () => editor.setTool('bus'),
    },

    ...PLACE_PARTS.map(
      (item): Command => ({
        id: item.id,
        label: item.label,
        ...(item.shortcuts && { shortcuts: item.shortcuts }),
        run: () => editor.placePart(item.type, item.props),
      }),
    ),

    {
      id: 'tool.probe',
      label: 'Probe',
      title: 'Click wires, pins and buses to add them to the waveforms',
      icon: Activity,
      shortcuts: ['P'],
      checked: () => editor.tool.get() === 'probe',
      run: () => editor.setTool('probe'),
    },
    {
      id: 'waves.toggleProbe',
      label: 'Add to Waveforms',
      menuLabel: () => {
        const spot = editor.contextProbe;
        return spot && editor.analyzer.indexOf(spot.ref) >= 0
          ? `Remove ${spot.ref} from Waveforms`
          : spot
            ? `Add ${spot.ref} to Waveforms`
            : 'Add to Waveforms';
      },
      icon: Activity,
      enabled: () => editor.contextProbe !== undefined,
      run: () => {
        const spot = editor.contextProbe;
        if (spot) editor.toggleProbe(spot.ref);
      },
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
      id: 'sim.stepBack',
      label: 'Step Back',
      title: 'Step Back to the moment before the last one something happened',
      icon: StepBack,
      shortcuts: ['Alt+F10'],
      global: true,
      enabled: () => simState() !== 'stopped',
      run: () => {
        simulation.stepBack();
      },
    },
    {
      id: 'debug.stepBackClock',
      label: 'Step Back Clock',
      title: 'Step Back Clock: to right before the last active edge of the step clock',
      icon: ChevronsLeft,
      shortcuts: ['Alt+F8'],
      global: true,
      enabled: () => simState() !== 'stopped',
      run: () => {
        if (editor.debug.stepBackClock() !== undefined) showDebug();
      },
    },
    {
      id: 'debug.reverseContinue',
      label: 'Reverse Continue',
      title: 'Reverse Continue: back to the previous breakpoint hit',
      icon: Rewind,
      shortcuts: ['Alt+F5'],
      global: true,
      enabled: () => simState() !== 'stopped',
      run: () => {
        editor.debug.reverseContinue();
      },
    },
    {
      id: 'sim.toPresent',
      label: 'Go to Present',
      title: 'Go to the present: the end of the recorded run',
      icon: SkipForward,
      enabled: () => simulation.history.get().behind,
      run: () => {
        simulation.toPresent();
      },
    },
    {
      id: 'debug.stepClock',
      label: 'Step Clock',
      title: 'Step Clock: to right before the next active edge of the step clock but one',
      icon: ChevronsRight,
      shortcuts: ['F8'],
      global: true,
      enabled: () => simState() !== 'halted',
      run: () => {
        if (editor.debug.stepClock() !== undefined) showDebug(); // it says why there
      },
    },
    {
      id: 'debug.runFor',
      label: 'Run For',
      menuLabel: () => `Run For ${formatTime(editor.debug.setup.get().runFor)}`,
      icon: Hourglass,
      shortcuts: ['Shift+F8'],
      global: true,
      enabled: () => simState() !== 'halted',
      run: () => {
        editor.debug.runFor();
      },
    },
    {
      id: 'debug.runTo',
      label: 'Run To…',
      enabled: () => simState() !== 'halted',
      run: () => {
        showDebug();
        ui.update((s) => ({ ...s, runToRequest: s.runToRequest + 1 }));
      },
    },
    {
      id: 'debug.addBreakpoint',
      label: 'Add Breakpoint…',
      icon: CircleDot,
      run: () => ui.update((s) => ({ ...s, breakpointDialog: {} })),
    },
    {
      id: 'debug.disableAll',
      label: 'Disable All Breakpoints',
      enabled: () => editor.debug.setup.get().breakpoints.some((b) => b.enabled),
      run: () => editor.debug.enableAll(false),
    },
    {
      id: 'debug.breakOnErrors',
      label: 'Break on Errors',
      checked: () => editor.debug.setup.get().breakOnErrors,
      run: () => editor.debug.setBreakOn({ errors: !editor.debug.setup.get().breakOnErrors }),
    },
    {
      id: 'debug.breakRise',
      label: 'Break When Rises',
      menuLabel: () => `Break When ${oneBit() ?? '…'} Rises`,
      icon: CircleDot,
      enabled: () => oneBit() !== undefined,
      run: () => {
        const signal = oneBit();
        if (signal === undefined) return;
        editor.debug.addBreakpoint([{ signal, kind: 'rise' }]);
        showDebug();
      },
    },
    {
      id: 'debug.addBreakpointOn',
      label: 'Add Breakpoint on…',
      menuLabel: () => {
        const spot = editor.contextProbe;
        return spot ? `Add Breakpoint on ${spot.ref}…` : 'Add Breakpoint on…';
      },
      enabled: () => editor.contextProbe !== undefined,
      run: () => {
        const spot = editor.contextProbe;
        if (spot) ui.update((s) => ({ ...s, breakpointDialog: { signal: spot.ref } }));
      },
    },
    {
      id: 'debug.watch',
      label: 'Watch',
      menuLabel: () => {
        const spot = editor.contextProbe;
        return spot ? `Watch ${spot.ref}` : 'Watch';
      },
      icon: Eye,
      enabled: () => editor.contextProbe !== undefined,
      run: () => {
        const spot = editor.contextProbe;
        if (!spot) return;
        editor.debug.addWatch(spot.ref);
        showDebug();
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
      id: 'test.run',
      label: 'Run Tests',
      title: 'Run the benches of the circuit open (in a sandbox)',
      icon: FlaskConical,
      shortcuts: ['Mod+Enter'],
      // Also from the script editor, where it is typed.
      global: true,
      enabled: () => tests !== undefined && editor.state.get().circuit.testScript.length > 0,
      run: () => {
        showTests();
        void tests?.runOpen();
      },
    },
    {
      id: 'test.runAll',
      label: 'Run All Tests',
      title: 'Run the benches of every circuit',
      icon: FastForward,
      shortcuts: ['Mod+Shift+Enter'],
      global: true,
      enabled: () =>
        tests !== undefined &&
        editor.state.get().document.circuits.some((c) => c.testScript.length > 0),
      run: () => {
        showTests();
        void tests?.runAll();
      },
    },
    {
      id: 'test.cancel',
      label: 'Cancel Tests',
      icon: Square,
      enabled: () => tests?.running === true,
      run: () => tests?.cancel(),
    },
    {
      id: 'test.insertImage',
      label: 'Insert Image…',
      title: 'Write a memory load from a .bin or Intel HEX file into the test script',
      enabled: () => tests !== undefined,
      run: () => {
        showTests();
        ui.update((s) => ({ ...s, insertImageRequest: true }));
      },
    },
    {
      id: 'test.show',
      label: 'Show Tests',
      title: 'The Tests tab: the test script of the circuit open and the results',
      run: showTests,
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

    ...(['circuits', 'parts', 'properties', 'bottom'] as const).map(
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
      label: `About ${APP_NAME}`,
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
        'file.gallery',
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
        'edit.inspectMemory',
        'parts.search',
      ],
    },
    { label: 'Place', items: PLACE_MENU },
    {
      label: 'Circuit',
      items: [
        'circuit.add',
        'circuit.addVerilog',
        'circuit.rename',
        'circuit.duplicate',
        'circuit.delete',
        SEPARATOR,
        'circuit.setTop',
        SEPARATOR,
        'circuit.goInto',
        'circuit.goUp',
        'circuit.goTop',
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
        'tool.wire',
        'tool.bus',
        'tool.interact',
        'tool.probe',
        SEPARATOR,
        'view.grid',
        { label: 'Theme', items: ['view.theme.system', 'view.theme.dark', 'view.theme.light'] },
        { label: 'Gate Style', items: ['view.gates.ansi', 'view.gates.iec'] },
        { label: 'Scroll Wheel', items: ['view.wheel.pan', 'view.wheel.zoom'] },
        SEPARATOR,
        {
          label: 'Panels',
          items: [
            'view.panel.circuits',
            'view.panel.parts',
            'view.panel.properties',
            'view.panel.bottom',
          ],
        },
      ],
    },
    {
      label: 'Simulate',
      items: [
        'sim.toggle',
        'sim.step',
        'debug.stepClock',
        'debug.runFor',
        'debug.runTo',
        SEPARATOR,
        'sim.stepBack',
        'debug.stepBackClock',
        'debug.reverseContinue',
        'sim.toPresent',
        SEPARATOR,
        'sim.stop',
        'sim.reset',
        SEPARATOR,
        'debug.addBreakpoint',
        'debug.disableAll',
        'debug.breakOnErrors',
        SEPARATOR,
        { label: 'Speed', items: ALL_SPEEDS.map((s) => `sim.speed.${s.id}`) },
        SEPARATOR,
        'tool.interact',
      ],
    },
    {
      label: 'Test',
      items: [
        'test.run',
        'test.runAll',
        'test.cancel',
        SEPARATOR,
        'test.insertImage',
        SEPARATOR,
        'test.show',
      ],
    },
    { label: 'Help', items: ['help.shortcuts', SEPARATOR, 'help.about'] },
  ];
}

/**
 * Parts placed often, one right click away (Place submenu) and in the Place menu: each arms the
 * sticky place tool, like a click in the Parts panel.
 */
const PLACE_PARTS: readonly {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, string>>;
  readonly shortcuts?: readonly string[];
}[] = [
  { id: 'place.vcc', label: 'Power (VCC)', type: 'io/vcc' },
  { id: 'place.gnd', label: 'Ground (GND)', type: 'io/gnd' },
  { id: 'place.pullUp', label: 'Pull-up', type: 'prim/pull', props: { direction: 'up' } },
  { id: 'place.pullDown', label: 'Pull-down', type: 'prim/pull', props: { direction: 'down' } },
  { id: 'place.netLabel', label: 'Net Label', type: 'net/label', shortcuts: ['L'] },
  // KiCad's key for a bus entry.
  { id: 'place.busEntry', label: 'Bus Entry', type: 'net/bus-entry', shortcuts: ['Z'] },
  // A subcircuit's interface pin: a label that leaves the circuit (KiCad's hierarchical label).
  { id: 'place.port', label: 'Port', type: 'net/port', shortcuts: ['Shift+L'] },
  // A note on the sheet (KiCad's key for text).
  { id: 'place.text', label: 'Text', type: 'draw/text', shortcuts: ['T'] },
];

/** The Place menu and the canvas context menu's Place submenu. */
export const PLACE_MENU: readonly MenuEntry[] = [
  'place.vcc',
  'place.gnd',
  'place.pullUp',
  'place.pullDown',
  SEPARATOR,
  'tool.wire',
  'tool.bus',
  'place.netLabel',
  'place.busEntry',
  'place.port',
  SEPARATOR,
  'place.text',
  SEPARATOR,
  'parts.search',
];

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
  'circuit.goInto',
  'edit.partInfo',
  'edit.inspectMemory',
  'waves.toggleProbe',
  'debug.breakRise',
  'debug.addBreakpointOn',
  'debug.watch',
];

export const CANVAS_CONTEXT_MENU: readonly MenuEntry[] = [
  { label: 'Place', items: PLACE_MENU },
  SEPARATOR,
  'edit.paste',
  SEPARATOR,
  'edit.selectAll',
  'view.zoomFit',
  SEPARATOR,
  'circuit.goUp',
];

/** Toolbar groups, separated by dividers. */
export const TOOLBAR: readonly (readonly string[])[] = [
  ['tool.select', 'tool.pan', 'tool.wire', 'tool.bus', 'tool.interact', 'tool.probe'],
  ['edit.undo', 'edit.redo'],
  ['edit.rotate', 'edit.flipH', 'edit.delete'],
  [
    'sim.toggle',
    'sim.stepBack',
    'sim.step',
    'debug.stepClock',
    'sim.stop',
    'sim.reset',
    'widget:speed',
  ],
  ['view.zoomIn', 'view.zoomOut', 'view.zoomFit'],
  ['view.grid', 'view.gates.toggle'],
];

/** `Circuit 2`, `Circuit 3`, …: the first name no circuit of the document has. */
export function freeCircuitName(document: CircuitDocument, stem = 'Circuit'): string {
  const names = new Set(document.circuits.map((c) => c.name));
  for (let n = document.circuits.length + 1; ; n++) {
    const name = `${stem} ${n}`;
    if (!names.has(name)) return name;
  }
}

/** The name of a new Verilog module: `Module N` (HDL-1). */
export function freeModuleName(document: CircuitDocument): string {
  return freeCircuitName(document, 'Module');
}

/** The CIRCUITS list's context menu: the Circuit commands, on the circuit it opened. */
export const CIRCUIT_CONTEXT_MENU: readonly MenuEntry[] = [
  'circuit.rename',
  'circuit.duplicate',
  'circuit.delete',
  SEPARATOR,
  'circuit.setTop',
];

/**
 * The memory the Memory tab shows for part `id` of the open circuit: a memory chip itself, or
 * the first memory of a Verilog module placed as `id` (`A1/rom`, HDL-6).
 */
export function memoryOfPart(editor: Editor, id: string): string | undefined {
  const part = editor.state.get().circuit.components.find((c) => c.id === id);
  if (!part) return undefined;
  if (editor.registry.get(part.type)?.memory) return part.id;
  const inside = `${part.id}/${MODULE_PART}`;
  return editor.memory.memories().find((m) => m.part === inside)?.id;
}
