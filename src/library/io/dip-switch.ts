import { defineComponent, type PinDef } from '../../core';
import {
  actionOf,
  badAction,
  type Contact,
  contactDir,
  contactDrive,
  contactProp,
} from './contact';

export const MAX_DIP_SWITCHES = 12;

/** Actions `io/dip-switch` accepts; `index` 0 is switch 1 (pin `S1`). */
export type DipSwitchAction =
  | { readonly type: 'toggle'; readonly index: number }
  | { readonly type: 'set'; readonly index: number; readonly on: boolean };

/** State of an `io/dip-switch`: the position of each switch, switch 1 first. */
export interface DipSwitchState {
  on: boolean[];
}

type Props = { count: number; contact: Contact; on: number };

/**
 * DIP switch bank: `count` independent switches `S1`…`Sn`. DIP switches are SPST, hence the
 * default: each closes to VCC and needs a pull-down (or use `spst-gnd` with pull-ups). `on` is a
 * bitmask of the positions at power-on (bit 0 = switch 1; bits above `count` are ignored).
 */
export const dipSwitch = defineComponent<Props, DipSwitchState>({
  type: 'io/dip-switch',
  name: 'DIP',
  title: 'DIP switch bank',
  keywords: ['dip', 'switch', 'bank', 'input', 'byte', 'address', 'data', 'spst'],
  props: [
    {
      key: 'count',
      label: 'Switches',
      type: 'integer',
      default: 8,
      min: 1,
      max: MAX_DIP_SWITCHES,
    },
    contactProp('spst-vcc'),
    {
      key: 'on',
      label: 'On at power-on (bit 0 = switch 1)',
      type: 'integer',
      default: 0,
      min: 0,
      max: 2 ** MAX_DIP_SWITCHES - 1,
    },
  ],
  pins: ({ count, contact }) =>
    Array.from(
      { length: count },
      (_, i): PinDef => ({ name: `S${i + 1}`, dir: contactDir(contact) }),
    ),
  // Switch i sits at row i + 1; the rails are drawn on the left.
  symbol: ({ count }) => ({
    kind: 'dip-switch',
    width: 3,
    height: count + 1,
    pins: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`S${i + 1}`, { side: 'right', offset: i + 1 }]),
    ),
  }),
  create: ({ count, contact, on }) => ({
    createState: () => ({ on: Array.from({ length: count }, (_, i) => ((on >> i) & 1) === 1) }),
    init(ctx) {
      for (let i = 0; i < count; i++) ctx.drive(i, contactDrive(contact, ctx.state.on[i]!), 0);
    },
    action(ctx, payload) {
      const action = actionOf(ctx.id, payload);
      const { index } = action;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) {
        throw badAction(ctx.id, payload);
      }
      if (action.type === 'toggle') ctx.state.on[index] = !ctx.state.on[index];
      else if (action.type === 'set' && typeof action.on === 'boolean')
        ctx.state.on[index] = action.on;
      else throw badAction(ctx.id, payload);
      ctx.drive(index, contactDrive(contact, ctx.state.on[index]!), 0);
    },
  }),
});
