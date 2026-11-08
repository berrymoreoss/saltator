import { describe, expect, it } from 'vitest';
import { Editor, Store } from '../editor';
import { createDefaultRegistry } from '../library';
import { ClipboardBridge } from './clipboard';
import { DocumentController } from './document-controller';
import type { FileAccess } from './files';
import { DEFAULT_SETTINGS } from './settings';
import { createUiState } from './ui-state';
import {
  CANVAS_CONTEXT_MENU,
  CIRCUIT_CONTEXT_MENU,
  createCommands,
  freeCircuitName,
  ITEM_CONTEXT_MENU,
  type MenuEntry,
  PLACE_MENU,
  TOOLBAR,
  workbenchMenus,
} from './workbench-commands';

const noFiles = {} as FileAccess;

function commands() {
  const editor = new Editor(createDefaultRegistry());
  const documents = new DocumentController({
    editor,
    files: noFiles,
    askUnsaved: async () => 'cancel',
    report: () => {},
  });
  const list = createCommands({
    editor,
    documents,
    clipboard: new ClipboardBridge(editor),
    settings: new Store(DEFAULT_SETTINGS),
    ui: createUiState(),
    examples: [],
  });
  return { editor, ids: new Set(list.map((c) => c.id)), list };
}

function ids(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : 'items' in entry ? ids(entry.items) : [],
  );
}

describe('workbench commands', () => {
  it('has a command for every menu, context menu and toolbar entry', () => {
    const { ids: known } = commands();
    const used = [
      ...workbenchMenus([], 3).flatMap((menu) => ids(menu.items)),
      ...ids(PLACE_MENU),
      ...ids(ITEM_CONTEXT_MENU),
      ...ids(CANVAS_CONTEXT_MENU),
      ...ids(CIRCUIT_CONTEXT_MENU),
      ...TOOLBAR.flat().filter((id) => !id.startsWith('widget:')), // widgets aren't commands
    ];
    expect(used.filter((id) => !known.has(id))).toEqual([]);
  });

  it('adds, renames, duplicates, sets the top and deletes circuits on the open one', () => {
    const { editor, list } = commands();
    const run = (id: string) => list.find((c) => c.id === id)!.run();
    const circuits = () => editor.state.get().document.circuits.map((c) => c.name);
    run('circuit.add');
    expect(circuits()).toEqual(['Main', 'Circuit 2']);
    expect(editor.state.get().circuit.name).toBe('Circuit 2');
    run('circuit.duplicate');
    expect(circuits()).toEqual(['Main', 'Circuit 2', 'Circuit 2 copy']);
    run('circuit.setTop');
    expect(circuits()).toEqual(['Circuit 2 copy', 'Main', 'Circuit 2']);
    run('circuit.delete');
    expect(circuits()).toEqual(['Main', 'Circuit 2']);
    expect(editor.state.get().circuit.name).toBe('Main');
    editor.undo();
    expect(circuits()).toEqual(['Circuit 2 copy', 'Main', 'Circuit 2']);
  });

  it('names a new circuit after the circuits there are', () => {
    const { editor } = commands();
    expect(freeCircuitName(editor.state.get().document)).toBe('Circuit 2');
  });
});
