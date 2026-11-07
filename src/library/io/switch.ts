import {
  Drive,
  defineComponent,
  type EvalContext,
  type PinDef,
  type PropDef,
  type SymbolDef,
} from '../../core';
import {
  actionOf,
  badAction,
  type Contact,
  contactDir,
  contactDrive,
  contactProp,
} from './contact';

/**
 * A switch's contact: one of the shared contacts (the pin is the common), or a changeover whose
 * common is tied to a rail and whose two throws are the pins: `ON` is closed in the on position,
 * `OFF` in the off position; the open throw is released (pull it up or down on the board). Ben
 * Eater's bistable 555 uses one to GND, its throws on TRIG and RESET.
 */
export type SwitchContact = Contact | 'spdt-gnd' | 'spdt-vcc';

const isChangeover = (contact: SwitchContact): contact is 'spdt-gnd' | 'spdt-vcc' =>
  contact === 'spdt-gnd' || contact === 'spdt-vcc';

const contactOptions = contactProp('spdt');
const switchContactProp: PropDef = {
  ...contactOptions,
  options: [
    ...(contactOptions.options ?? []),
    { value: 'spdt-gnd', label: 'SPDT, common to GND: ON/OFF throw 0 when closed, open else' },
    { value: 'spdt-vcc', label: 'SPDT, common to VCC: ON/OFF throw 1 when closed, open else' },
  ],
};

function switchPins(contact: SwitchContact): PinDef[] {
  if (!isChangeover(contact)) return [{ name: 'Y', dir: contactDir(contact) }];
  return [
    { name: 'ON', dir: 'tristate', description: 'throw closed in the on position' },
    { name: 'OFF', dir: 'tristate', description: 'throw closed in the off position' },
  ];
}

function switchSymbol(contact: SwitchContact): SymbolDef {
  const pins: SymbolDef['pins'] = isChangeover(contact)
    ? { ON: { side: 'right', offset: 0 }, OFF: { side: 'right', offset: 2 } }
    : { Y: { side: 'right', offset: 1 } };
  return { kind: 'switch', width: 3, height: 2, pins };
}

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
export const toggleSwitch = defineComponent<{ contact: SwitchContact; on: boolean }, SwitchState>({
  type: 'io/switch',
  name: 'SW',
  title: 'Toggle switch',
  keywords: ['switch', 'toggle', 'slide', 'input', 'spdt', 'spst', 'lever'],
  designatorPrefix: 'SW',
  props: [
    switchContactProp,
    { key: 'on', label: 'On at power-on', type: 'boolean', default: false },
  ],
  pins: ({ contact }) => switchPins(contact),
  symbol: ({ contact }) => switchSymbol(contact),
  create: ({ contact, on }) => {
    const changeover = isChangeover(contact);
    const rail = contact === 'spdt-vcc' ? Drive.STRONG_1 : Drive.STRONG_0;
    const drive = (ctx: EvalContext<SwitchState>, on: boolean) => {
      if (!changeover) {
        ctx.drive(0, contactDrive(contact, on), 0);
        return;
      }
      ctx.drive(0, on ? rail : Drive.Z, 0); // ON throw
      ctx.drive(1, on ? Drive.Z : rail, 0); // OFF throw
    };
    return {
      createState: () => ({ on }),
      init: (ctx) => drive(ctx, ctx.state.on),
      action(ctx, payload) {
        const action = actionOf(ctx.id, payload);
        if (action.type === 'toggle') ctx.state.on = !ctx.state.on;
        else if (action.type === 'set' && typeof action.on === 'boolean') ctx.state.on = action.on;
        else throw badAction(ctx.id, payload);
        drive(ctx, ctx.state.on);
      },
    };
  },
});
