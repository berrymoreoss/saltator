/**
 * How parts are operated on the canvas while simulating (the Interact tool), keyed by
 * `symbol.kind` like the drawers: where a press lands in the part's local cells → the action
 * the part takes (`sim.action`), and for momentary parts the action on release. Actions are the
 * part's own (`SwitchAction`, `ButtonAction`, … in src/library/io). Spec:
 * docs/editor.md#interacting-with-parts.
 */
import type { Point, Rect } from '../../circuit';
import type { PropValue } from '../../core';

export interface InteractContext {
  /** Where the press is, in the part's local cells. */
  readonly local: Point;
  /** The body rectangle, local cells. */
  readonly body: Rect;
  readonly props: Readonly<Record<string, PropValue>>;
}

/** What a press does: an action now and, for momentary parts, one on release. */
export interface Poke {
  readonly press: unknown;
  readonly release?: unknown;
}

/** Maps a press on a part to a poke, or undefined where the part takes none. */
export type Interaction = (c: InteractContext) => Poke | undefined;

export const INTERACTIONS: Readonly<Record<string, Interaction>> = {
  switch: () => ({ press: { type: 'toggle' } }),
  button: () => ({ press: { type: 'press' }, release: { type: 'release' } }),
  /** Switch i sits on row i + 1 of the body: the row nearest the press. */
  'dip-switch': ({ local, body }) => {
    const index = Math.round(local[1] - body.y) - 1;
    if (index < 0 || index >= body.height - 1) return undefined;
    return { press: { type: 'toggle', index } };
  },
  /** A free-running clock takes no clicks; a manual one emits a pulse per click. */
  clock: ({ props }) => (props.mode === 'manual' ? { press: { type: 'step' } } : undefined),
};
