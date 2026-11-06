/**
 * Switch contacts, shared by switches, buttons and DIP switches. A contact either changes over
 * between the rails (SPDT: always drives) or closes onto one rail (SPST: releases the net when
 * open, so it needs a pull resistor — as on a breadboard). See docs/adr/0007-io-electrical-model.md.
 */
import { Drive, type PinDir, type PropDef } from '../../core';

export type Contact = 'spdt' | 'spst-vcc' | 'spst-gnd';

/** The `contact` prop, with the real part's contact as the default. */
export function contactProp(fallback: Contact): PropDef {
  return {
    key: 'contact',
    label: 'Contact',
    type: 'enum',
    default: fallback,
    options: [
      { value: 'spdt', label: 'SPDT: 1 when on, 0 when off' },
      { value: 'spst-vcc', label: 'SPST to VCC: 1 when on, open when off (add a pull-down)' },
      { value: 'spst-gnd', label: 'SPST to GND: 0 when on, open when off (add a pull-up)' },
    ],
  };
}

/** A changeover always drives its pin; an SPST contact can release it. */
export function contactDir(contact: Contact): PinDir {
  return contact === 'spdt' ? 'out' : 'tristate';
}

/** What a contact drives in a position. */
export function contactDrive(contact: Contact, on: boolean): Drive {
  switch (contact) {
    case 'spdt':
      return on ? Drive.STRONG_1 : Drive.STRONG_0;
    case 'spst-vcc':
      return on ? Drive.STRONG_1 : Drive.Z;
    case 'spst-gnd':
      return on ? Drive.STRONG_0 : Drive.Z;
  }
}

/** Throws a readable error for an action payload a part doesn't understand (a host bug). */
export function badAction(id: string, payload: unknown): Error {
  return new Error(`${id}: unknown action ${JSON.stringify(payload)}`);
}

/** Narrows an action payload to an object with a string `type`, or throws. */
export function actionOf(
  id: string,
  payload: unknown,
): { readonly type: string } & Record<string, unknown> {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { type?: unknown }).type === 'string'
  ) {
    return payload as { readonly type: string } & Record<string, unknown>;
  }
  throw badAction(id, payload);
}
