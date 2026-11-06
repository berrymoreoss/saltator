import { defineComponent } from '../../core';
import {
  actionOf,
  badAction,
  type Contact,
  contactDir,
  contactDrive,
  contactProp,
} from './contact';

/** Actions `io/button` accepts (`sim.action(id, …)`). */
export type ButtonAction = { readonly type: 'press' } | { readonly type: 'release' };

/** State of an `io/button`. */
export interface ButtonState {
  pressed: boolean;
}

/**
 * Momentary push button: on while pressed, released at power-on. Breadboard tactile buttons are
 * SPST, hence the default: closes to VCC, needs a pull-down. Contact bounce is not modelled.
 */
export const pushButton = defineComponent<{ contact: Contact }, ButtonState>({
  type: 'io/button',
  name: 'BTN',
  title: 'Push button (momentary)',
  keywords: ['button', 'push', 'momentary', 'tactile', 'key', 'input', 'spst'],
  props: [contactProp('spst-vcc')],
  pins: ({ contact }) => [{ name: 'Y', dir: contactDir(contact) }],
  symbol: { kind: 'button', width: 3, height: 2, pins: { Y: { side: 'right', offset: 1 } } },
  create: ({ contact }) => ({
    createState: () => ({ pressed: false }),
    init: (ctx) => ctx.drive(0, contactDrive(contact, false), 0),
    action(ctx, payload) {
      const { type } = actionOf(ctx.id, payload);
      if (type !== 'press' && type !== 'release') throw badAction(ctx.id, payload);
      ctx.state.pressed = type === 'press';
      ctx.drive(0, contactDrive(contact, ctx.state.pressed), 0);
    },
  }),
});
