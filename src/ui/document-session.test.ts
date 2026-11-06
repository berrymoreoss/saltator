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
  documentOf,
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
    expect(hasUnsavedChanges(session, session.document.circuits[0]!)).toBe(false);
  });

  it('an opened file is clean until edited, and clean again when undone to the saved circuit', () => {
    const saved = circuit();
    const file = { name: 'adder.logic.json' };
    const session = openedSession('adder', documentWith(saved), file);
    expect(session.file).toBe(file);
    expect(hasUnsavedChanges(session, saved)).toBe(false);

    const moved = updateComponent(saved, 'U1', { x: 3 });
    expect(hasUnsavedChanges(session, moved)).toBe(true);
    // Undo restores the very snapshot; a value-equal circuit counts as unchanged too.
    expect(hasUnsavedChanges(session, saved)).toBe(false);
    expect(hasUnsavedChanges(session, updateComponent(moved, 'U1', { x: 0 }))).toBe(false);
  });

  it('an example opens as an untitled copy named after it, clean while unchanged', () => {
    const session = exampleSession('Hello, LED', documentWith(circuit()));
    expect(session.name).toBe('Hello, LED');
    expect(session.file).toBeUndefined();
    expect(hasUnsavedChanges(session, session.document.circuits[0]!)).toBe(false);
  });

  it('saving records the circuit, the name and the file', () => {
    const session = newSession();
    const edited = circuit();
    expect(hasUnsavedChanges(session, edited)).toBe(true);
    const file = { name: 'nand.logic.json' };
    const saved = savedSession(session, edited, 'nand', file);
    expect(saved).toMatchObject({ name: 'nand', file, saved: edited });
    expect(saved.document.circuits[0]).toBe(edited);
    expect(hasUnsavedChanges(saved, edited)).toBe(false);
    // A download keeps no file to write back to.
    expect(savedSession(saved, edited, 'nand').file).toBeUndefined();
  });

  it('a session that was never saved anywhere always has unsaved changes', () => {
    const { saved: _, ...restored } = newSession();
    expect(hasUnsavedChanges(restored, restored.document.circuits[0]!)).toBe(true);
  });

  it('saving replaces the first circuit and keeps the others', () => {
    const other = circuit('sub');
    const session = openedSession('cpu', documentWith(circuit(), other));
    const edited = updateComponent(circuit(), 'U1', { x: 5 });
    expect(documentOf(session, edited).circuits).toEqual([edited, other]);
    const text = documentText(session, edited);
    expect(parseDocument(text).circuits.map((c) => c.id)).toEqual(['main', 'sub']);
    expect(parseDocument(text).circuits[0]).toEqual(edited);
  });
});

describe('file names', () => {
  it('a name becomes a .logic.json file name, unusable characters replaced', () => {
    expect(fileNameOf('Hello, LED')).toBe('Hello, LED.logic.json');
    expect(fileNameOf('a/b:c*?"<>|\\d')).toBe('a-b-c-------d.logic.json');
    expect(fileNameOf('tab\there')).toBe('tab-here.logic.json');
    expect(fileNameOf('   ')).toBe('Untitled.logic.json');
  });

  it('a file name becomes the document name', () => {
    expect(nameOfFile('adder.logic.json')).toBe('adder');
    expect(nameOfFile('Adder.LOGIC.JSON')).toBe('Adder');
    expect(nameOfFile('adder.json')).toBe('adder');
    expect(nameOfFile('adder (1).logic.json')).toBe('adder (1)');
    expect(nameOfFile('notes.txt')).toBe('notes.txt');
    expect(nameOfFile('.logic.json')).toBe(UNTITLED);
    expect(nameOfFile(fileNameOf('Hello, LED'))).toBe('Hello, LED');
  });

  it('the title marks unsaved changes', () => {
    expect(documentTitle('adder', false)).toBe('adder — Logic');
    expect(documentTitle('adder', true)).toBe('• adder — Logic');
  });
});
