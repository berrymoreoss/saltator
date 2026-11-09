import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  type CircuitDocument,
  emptyCircuit,
  parseDocument,
  SCHEMA_VERSION,
  updateComponent,
} from '../circuit';
import {
  documentText,
  documentTitle,
  exampleSession,
  fileNameOf,
  hasUnsavedChanges,
  nameOfFile,
  newSession,
  openedSession,
  savedSession,
  UNTITLED,
} from './document-session';

const circuit = (id = 'main'): Circuit => ({
  ...emptyCircuit(id, 'Main'),
  components: [{ id: 'U1', type: 'prim/nand', x: 0, y: 0, rotation: 0, flip: false, props: {} }],
});
const documentWith = (...circuits: Circuit[]): CircuitDocument => ({
  schemaVersion: SCHEMA_VERSION,
  circuits,
});

describe('document session', () => {
  it('a new document is untitled, has no file and nothing to lose', () => {
    const session = newSession();
    expect(session.name).toBe(UNTITLED);
    expect(session.file).toBeUndefined();
    expect(hasUnsavedChanges(session, session.document)).toBe(false);
  });

  it('an opened file is clean until edited, and clean again when undone to the saved document', () => {
    const saved = documentWith(circuit());
    const file = { name: 'adder.saltator.json' };
    const session = openedSession('adder', saved, file);
    expect(session.file).toBe(file);
    expect(hasUnsavedChanges(session, saved)).toBe(false);

    const moved = documentWith(updateComponent(circuit(), 'U1', { x: 3 }));
    expect(hasUnsavedChanges(session, moved)).toBe(true);
    // Undo restores the very snapshot; a value-equal document counts as unchanged too.
    expect(hasUnsavedChanges(session, saved)).toBe(false);
    expect(hasUnsavedChanges(session, documentWith(circuit()))).toBe(false);
  });

  it('counts a change in any circuit, and circuits added or reordered', () => {
    const saved = documentWith(circuit(), circuit('sub'));
    const session = openedSession('cpu', saved);
    const inSub = documentWith(circuit(), updateComponent(circuit('sub'), 'U1', { x: 5 }));
    expect(hasUnsavedChanges(session, inSub)).toBe(true);
    expect(hasUnsavedChanges(session, documentWith(circuit('sub'), circuit()))).toBe(true);
    expect(hasUnsavedChanges(session, documentWith(circuit()))).toBe(true);
  });

  it('an example opens as an untitled copy named after it, clean while unchanged', () => {
    const session = exampleSession('Hello, LED', documentWith(circuit()));
    expect(session.name).toBe('Hello, LED');
    expect(session.file).toBeUndefined();
    expect(hasUnsavedChanges(session, session.document)).toBe(false);
  });

  it('saving records the document, the name and the file', () => {
    const session = newSession();
    const edited = documentWith(circuit(), circuit('sub'));
    expect(hasUnsavedChanges(session, edited)).toBe(true);
    const file = { name: 'nand.saltator.json' };
    const saved = savedSession(session, edited, 'nand', file);
    expect(saved).toMatchObject({ name: 'nand', file, saved: edited, document: edited });
    expect(hasUnsavedChanges(saved, edited)).toBe(false);
    // A download keeps no file to write back to.
    expect(savedSession(saved, edited, 'nand').file).toBeUndefined();
    const text = documentText(edited);
    expect(parseDocument(text).circuits.map((c) => c.id)).toEqual(['main', 'sub']);
  });

  it('a session that was never saved anywhere always has unsaved changes', () => {
    const { saved: _, ...restored } = newSession();
    expect(hasUnsavedChanges(restored, restored.document)).toBe(true);
  });
});

describe('file names', () => {
  it('a name becomes a .saltator.json file name, unusable characters replaced', () => {
    expect(fileNameOf('Hello, LED')).toBe('Hello, LED.saltator.json');
    expect(fileNameOf('a/b:c*?"<>|\\d')).toBe('a-b-c-------d.saltator.json');
    expect(fileNameOf('tab\there')).toBe('tab-here.saltator.json');
    expect(fileNameOf('   ')).toBe('Untitled.saltator.json');
  });

  it('a file name becomes the document name', () => {
    expect(nameOfFile('adder.saltator.json')).toBe('adder');
    expect(nameOfFile('Adder.SALTATOR.JSON')).toBe('Adder');
    expect(nameOfFile('adder.json')).toBe('adder');
    expect(nameOfFile('adder (1).saltator.json')).toBe('adder (1)');
    expect(nameOfFile('notes.txt')).toBe('notes.txt');
    expect(nameOfFile('.saltator.json')).toBe(UNTITLED);
    expect(nameOfFile(fileNameOf('Hello, LED'))).toBe('Hello, LED');
  });

  it('an old .logic.json file loads as plain .json: no legacy extension (ADR-0032)', () => {
    expect(nameOfFile('adder.logic.json')).toBe('adder.logic');
  });

  it('the title marks unsaved changes', () => {
    expect(documentTitle('adder', false)).toBe('adder — Logic');
    expect(documentTitle('adder', true)).toBe('• adder — Logic');
  });
});
