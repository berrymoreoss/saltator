/**
 * The breadcrumb bar's content (R11b): where the open circuit is in the design — the top, then
 * each instance down to the one open — the other instances of it to switch to, and what an edit
 * there changes. Pure, on the editor state.
 */
import type { EditorState } from '../editor';

export interface Crumb {
  /** Its instance path (`''` the top); undefined for a circuit placed nowhere. */
  readonly path: string | undefined;
  /** `Main`, `A2 · Counter Digit`. */
  readonly label: string;
}

export interface BreadcrumbView {
  /** From the top circuit down to the open one; the last is where one is. */
  readonly crumbs: readonly Crumb[];
  /** Every instance of the open circuit in the design, in design order (at least the open one). */
  readonly instances: readonly string[];
  /** What an edit here changes, or why nothing is live. */
  readonly note?: string;
}

export function breadcrumbView(
  state: Pick<EditorState, 'document' | 'design' | 'circuit' | 'path'>,
): BreadcrumbView {
  const { document, design, circuit, path } = state;
  const names = new Map(document.circuits.map((c) => [c.id, c.name]));
  const top: Crumb = { path: '', label: names.get(design.top) ?? design.top };
  if (path === undefined) {
    return {
      crumbs: [top, { path: undefined, label: circuit.name }],
      instances: [],
      note: `Placed nowhere in ${top.label}: drawn without levels`,
    };
  }
  const crumbs = [top];
  if (path !== '') {
    const designators = path.split('/');
    for (let i = 0; i < designators.length; i++) {
      const at = designators.slice(0, i + 1).join('/');
      const id = design.circuitAt(at) ?? '';
      crumbs.push({ path: at, label: `${designators[i]} · ${names.get(id) ?? id}` });
    }
  }
  const instances =
    path === ''
      ? ['']
      : design.instances.filter((i) => i.circuit === circuit.id).map((i) => i.path);
  return {
    crumbs,
    instances,
    ...(instances.length > 1 && { note: `Edits change all ${instances.length} instances` }),
  };
}
