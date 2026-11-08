import { describe, expect, it } from 'vitest';
import { type CircuitDocument, emptyDocument, parseDocument, serializeDocument } from '../circuit';
import { Editor } from '../editor';
import { createDefaultRegistry } from '../library';
import { DocumentController, type FileProblem, type UnsavedChoice } from './document-controller';
import { openedSession } from './document-session';
import type { FileAccess, OpenedFile, SavedFile } from './files';

const registry = createDefaultRegistry();

/** A document with one NAND at x. */
function nandDocument(x = 0): CircuitDocument {
  const document = emptyDocument();
  const circuit = document.circuits[0]!;
  return {
    ...document,
    circuits: [
      {
        ...circuit,
        components: [{ id: 'U1', type: 'prim/nand', x, y: 0, rotation: 0, flip: false, props: {} }],
      },
    ],
  };
}

/** In-memory files: `disk` by name; pickers answer from queues. */
class FakeFiles implements FileAccess {
  kind: 'native' | 'fallback' = 'native';
  readonly disk = new Map<string, string>();
  /** File names the open picker returns next; `undefined` = cancelled. */
  readonly opens: (string | undefined)[] = [];
  /** File names the save picker returns next; `undefined` = cancelled. */
  readonly saves: (string | undefined)[] = [];
  readonly suggested: string[] = [];
  /** Handles that refuse write permission. */
  readonly readOnly = new Set<string>();

  async open(): Promise<OpenedFile | undefined> {
    const name = this.opens.shift();
    return name === undefined ? undefined : this.#file(name);
  }
  async read(handle: { name: string }) {
    return this.#file(handle.name);
  }
  async write(handle: { name: string }, text: string) {
    if (this.readOnly.has(handle.name)) return false;
    this.disk.set(handle.name, text);
    return true;
  }
  async saveAs(text: string, suggestedName: string): Promise<SavedFile | undefined> {
    this.suggested.push(suggestedName);
    const name = this.saves.shift();
    if (name === undefined) return undefined;
    this.disk.set(name, text);
    return this.kind === 'native' ? { name, handle: { name } } : { name };
  }
  #file(name: string): OpenedFile {
    const text = this.disk.get(name);
    if (text === undefined) throw new Error(`no such file: ${name}`);
    return { name, text, ...(this.kind === 'native' && { handle: { name } }) };
  }
}

function setup(answers: UnsavedChoice[] = []) {
  const editor = new Editor(registry);
  const files = new FakeFiles();
  const asked: string[] = [];
  const problems: FileProblem[] = [];
  const documents = new DocumentController({
    editor,
    files,
    askUnsaved: async (name) => {
      asked.push(name);
      return answers.shift() ?? 'cancel';
    },
    report: (problem) => problems.push(problem),
  });
  const circuit = () => editor.state.get().circuit;
  const moveU1 = (x: number) =>
    editor.edit('Move', {
      ...circuit(),
      components: circuit().components.map((c) => (c.id === 'U1' ? { ...c, x } : c)),
    });
  return { editor, files, documents, asked, problems, circuit, moveU1 };
}

describe('DocumentController', () => {
  it('starts with a new, untitled document with nothing to lose', async () => {
    const { documents, asked } = setup();
    expect(documents.session.get().name).toBe('Untitled');
    expect(documents.unsaved).toBe(false);
    expect(await documents.newDocument()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('opens a file: name from the file, circuit in the editor, history cleared, clean', async () => {
    const { editor, files, documents, asked, circuit } = setup(['discard']);
    editor.edit('Place', nandDocument(4).circuits[0]!);
    expect(documents.unsaved).toBe(true);
    files.disk.set('adder.logic.json', serializeDocument(nandDocument(7)));
    files.opens.push('adder.logic.json');
    expect(await documents.open()).toBe(true);
    expect(asked).toEqual(['Untitled']); // answered "Don't Save"
    expect(documents.session.get()).toMatchObject({
      name: 'adder',
      file: { name: 'adder.logic.json' },
    });
    expect(circuit().components[0]!.x).toBe(7);
    expect(editor.undoLabel).toBeUndefined();
    expect(documents.unsaved).toBe(false);
  });

  it('opens and saves every circuit of a document; an edit in any of them is unsaved', async () => {
    const { editor, files, documents } = setup();
    const two: CircuitDocument = {
      ...nandDocument(1),
      circuits: [
        nandDocument(1).circuits[0]!,
        { ...nandDocument(2).circuits[0]!, id: 'sub', name: 'Sub' },
      ],
    };
    files.disk.set('cpu.logic.json', serializeDocument(two));
    files.opens.push('cpu.logic.json');
    expect(await documents.open()).toBe(true);
    expect(editor.state.get().document.circuits.map((c) => c.id)).toEqual(['main', 'sub']);
    expect(editor.state.get().circuit.id).toBe('main');
    editor.openCircuit('sub');
    expect(documents.unsaved).toBe(false);
    const sub = editor.state.get().circuit;
    editor.edit('Move', { ...sub, components: sub.components.map((c) => ({ ...c, x: 9 })) });
    expect(documents.unsaved).toBe(true);
    expect(await documents.save()).toBe(true);
    const saved = parseDocument(files.disk.get('cpu.logic.json')!);
    expect(saved.circuits.map((c) => c.id)).toEqual(['main', 'sub']);
    expect(saved.circuits[1]!.components[0]!.x).toBe(9);
    expect(documents.unsaved).toBe(false);
  });

  it('asks before replacing unsaved changes: Cancel keeps them, Save saves first', async () => {
    const cancel = setup(['cancel']);
    cancel.documents.show(openedSession('a', nandDocument(), { name: 'a.logic.json' }));
    cancel.moveU1(3);
    expect(await cancel.documents.newDocument()).toBe(false);
    expect(cancel.asked).toEqual(['a']);
    expect(cancel.circuit().components[0]!.x).toBe(3);
    expect(cancel.editor.undoLabel).toBe('Move');

    const save = setup(['save']);
    save.documents.show(openedSession('a', nandDocument(), { name: 'a.logic.json' }));
    save.moveU1(3);
    expect(await save.documents.newDocument()).toBe(true);
    expect(parseDocument(save.files.disk.get('a.logic.json')!).circuits[0]!.components[0]!.x).toBe(
      3,
    );
    expect(save.circuit().components).toEqual([]);
  });

  it('a cancelled Save As while answering Save cancels the whole action', async () => {
    const { documents, editor, files, circuit } = setup(['save']);
    editor.edit('Place', nandDocument(2).circuits[0]!);
    files.saves.push(undefined);
    expect(await documents.newDocument()).toBe(false);
    expect(files.suggested).toEqual(['Untitled.logic.json']);
    expect(circuit().components).toHaveLength(1);
  });

  it('a cancelled open picker changes nothing', async () => {
    const { documents, files } = setup();
    files.opens.push(undefined);
    expect(await documents.open()).toBe(false);
    expect(documents.session.get().name).toBe('Untitled');
  });

  it('a file that does not load is reported and leaves the document alone', async () => {
    const { documents, files, problems, editor, circuit } = setup([
      'discard',
      'discard',
      'discard',
    ]);
    editor.edit('Place', nandDocument(2).circuits[0]!);
    files.disk.set('broken.logic.json', '{"schemaVersion": 1, "circuits": []}');
    files.disk.set('future.logic.json', '{"schemaVersion": 99, "circuits": []}');
    files.disk.set('text.logic.json', 'hello');
    for (const name of ['broken', 'future', 'text']) {
      files.opens.push(`${name}.logic.json`);
      expect(await documents.open()).toBe(false);
    }
    expect(problems.map((p) => p.title)).toEqual(Array(3).fill('Cannot open file'));
    expect(problems[0]!.message).toContain('broken.logic.json');
    expect(problems[0]!.details).toEqual([expect.stringContaining('circuits')]);
    expect(problems[1]!.details).toEqual([expect.stringContaining('newer version')]);
    expect(problems[2]!.details).toEqual([expect.stringContaining('not valid JSON')]);
    expect(circuit().components).toHaveLength(1);
    expect(documents.unsaved).toBe(true);
  });

  it('Save writes to the file; Save As asks for a name; the session follows', async () => {
    const { documents, files, editor, moveU1 } = setup();
    editor.edit('Place', nandDocument(1).circuits[0]!);
    files.saves.push('nand.logic.json');
    expect(await documents.save()).toBe(true); // untitled: Save As
    expect(files.suggested).toEqual(['Untitled.logic.json']);
    expect(documents.session.get()).toMatchObject({
      name: 'nand',
      file: { name: 'nand.logic.json' },
    });
    expect(documents.unsaved).toBe(false);

    moveU1(5);
    expect(documents.unsaved).toBe(true);
    expect(await documents.save()).toBe(true); // to the same file, no picker
    expect(files.suggested).toHaveLength(1);
    expect(parseDocument(files.disk.get('nand.logic.json')!).circuits[0]!.components[0]!.x).toBe(5);
    expect(documents.unsaved).toBe(false);

    // Undo back past the save: unsaved again; redo: clean.
    editor.undo();
    expect(documents.unsaved).toBe(true);
    editor.redo();
    expect(documents.unsaved).toBe(false);

    files.saves.push('copy.logic.json');
    expect(await documents.saveAs()).toBe(true);
    expect(files.suggested.at(-1)).toBe('nand.logic.json');
    expect(documents.session.get().name).toBe('copy');
  });

  it('Save falls back to Save As when write permission is refused', async () => {
    const { documents, files, moveU1 } = setup();
    documents.show(openedSession('a', nandDocument(), { name: 'a.logic.json' }));
    files.readOnly.add('a.logic.json');
    moveU1(2);
    files.saves.push('b.logic.json');
    expect(await documents.save()).toBe(true);
    expect(files.disk.has('a.logic.json')).toBe(false);
    expect(documents.session.get().name).toBe('b');
  });

  it('without file handles (fallback), every Save downloads', async () => {
    const { documents, files, editor } = setup();
    files.kind = 'fallback';
    editor.edit('Place', nandDocument(1).circuits[0]!);
    files.saves.push('nand.logic.json', 'nand.logic.json');
    expect(await documents.save()).toBe(true);
    expect(documents.session.get().file).toBeUndefined();
    expect(documents.unsaved).toBe(false);
    expect(await documents.save()).toBe(true);
    expect(files.suggested).toEqual(['Untitled.logic.json', 'nand.logic.json']);
  });

  it('a failing write is reported, and the document stays unsaved', async () => {
    const { documents, files, problems, moveU1 } = setup();
    documents.show(openedSession('a', nandDocument(), { name: 'a.logic.json' }));
    files.write = async () => Promise.reject(new Error('disk full'));
    moveU1(2);
    expect(await documents.save()).toBe(false);
    expect(problems).toEqual([{ title: 'File error', message: 'disk full' }]);
    expect(documents.unsaved).toBe(true);
  });

  it('an example opens as an untitled copy named after it; a dropped file opens like Open', async () => {
    const { documents, files, circuit } = setup();
    expect(await documents.openExample('Hello, NAND', () => nandDocument(9))).toBe(true);
    expect(documents.session.get()).toMatchObject({ name: 'Hello, NAND' });
    expect(documents.session.get().file).toBeUndefined();
    expect(documents.unsaved).toBe(false);
    expect(circuit().components[0]!.x).toBe(9);

    files.disk.set('dropped.logic.json', serializeDocument(nandDocument(4)));
    expect(
      await documents.openFile({
        name: 'dropped.logic.json',
        text: files.disk.get('dropped.logic.json')!,
      }),
    ).toBe(true);
    expect(documents.session.get().name).toBe('dropped');
    expect(circuit().components[0]!.x).toBe(4);
  });

  it('one file operation at a time', async () => {
    const { documents, files, editor } = setup();
    editor.edit('Place', nandDocument(1).circuits[0]!);
    files.saves.push('a.logic.json');
    const first = documents.save();
    expect(await documents.save()).toBe(false);
    expect(await first).toBe(true);
  });

  it('opening stops a running simulation', async () => {
    const { documents, editor } = setup();
    editor.simulation.run();
    expect(editor.simulation.state).toBe('running');
    await documents.newDocument();
    expect(editor.simulation.state).toBe('stopped');
  });
});
