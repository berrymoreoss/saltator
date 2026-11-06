import { defineComponent } from '../../core';
import {
  actionOf,
  badAction,
  type Contact,
  contactDir,
  contactDrive,
  contactProp,
} from './contact';

/** Actions `io/switch` accepts (`sim.action(id, …)`). */
export type SwitchAction =
  | { readonly type: 'toggle' }
  | { readonly type: 'set'; readonly on: boolean };

/** State of an `io/switch`: its current position (the renderer draws the lever from it). */
export interface SwitchState {
  on: boolean;
}

/**
 * Toggle switch (slide or toggle). Stays where it was put; `on` is the position at power-on.
 * Changes take effect at the time of the action (contact bounce is not modelled).
 */
export const toggleSwitch = defineComponent<{ contact: Contact; on: boolean }, SwitchState>({
  type: 'io/switch',
  name: 'SW',
  title: 'Toggle switch',
  keywords: ['switch', 'toggle', 'slide', 'input', 'spdt', 'spst', 'lever'],
  designatorPrefix: 'SW',
  props: [
    contactProp('spdt'),
    { key: 'on', label: 'On at power-on', type: 'boolean', default: false },
  ],
  pins: ({ contact }) => [{ name: 'Y', dir: contactDir(contact) }],
  symbol: { kind: 'switch', width: 3, height: 2, pins: { Y: { side: 'right', offset: 1 } } },
  create: ({ contact, on }) => ({
    createState: () => ({ on }),
    init: (ctx) => ctx.drive(0, contactDrive(contact, ctx.state.on), 0),
    action(ctx, payload) {
      const action = actionOf(ctx.id, payload);
      if (action.type === 'toggle') ctx.state.on = !ctx.state.on;
      else if (action.type === 'set' && typeof action.on === 'boolean') ctx.state.on = action.on;
      else throw badAction(ctx.id, payload);
      ctx.drive(0, contactDrive(contact, ctx.state.on), 0);
    },
  }),
});
