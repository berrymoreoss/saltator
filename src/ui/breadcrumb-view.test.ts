import { describe, expect, it } from 'vitest';
import { addCircuit } from '../circuit';
import { testDriver } from '../core/testing';
import { Editor } from '../editor';
import { chainDesign } from '../editor/test-documents';
import { createDefaultRegistry } from '../library';
import { breadcrumbView } from './breadcrumb-view';

const library = createDefaultRegistry().register(testDriver);

describe('breadcrumbView', () => {
  it('is the top alone at the top', () => {
    const editor = new Editor(library, chainDesign(library));
    expect(breadcrumbView(editor.state.get())).toEqual({
      crumbs: [{ path: '', label: 'Main' }],
      instances: [''],
    });
  });

  it('lists each instance down to the one open, and the others of its circuit', () => {
    const editor = new Editor(library, chainDesign(library));
    editor.openInstance('A2/A1');
    expect(breadcrumbView(editor.state.get())).toEqual({
      crumbs: [
        { path: '', label: 'Main' },
        { path: 'A2', label: 'A2 · Chain' },
        { path: 'A2/A1', label: 'A1 · Inverter' },
      ],
      instances: ['A1/A1', 'A1/A2', 'A2/A1', 'A2/A2'],
      note: 'Edits change all 4 instances',
    });
  });

  it('says a circuit placed nowhere is drawn without levels', () => {
    const editor = new Editor(library, chainDesign(library));
    const { document, id } = addCircuit(editor.state.get().document, 'Spare');
    editor.editDocument('Add Circuit', document, { open: id });
    expect(breadcrumbView(editor.state.get())).toEqual({
      crumbs: [
        { path: '', label: 'Main' },
        { path: undefined, label: 'Spare' },
      ],
      instances: [],
      note: 'Placed nowhere in Main: drawn without levels',
    });
  });
});
