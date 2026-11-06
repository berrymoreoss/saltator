import { defineComponent, Level, strong } from '../../core';

/**
 * Power rail symbols: a connection to VCC (logic 1) or GND (logic 0), driven strong from t = 0.
 * The pin is marked `constant`, so wiring two VCC symbols together is not a short (VCC to GND
 * is). Each symbol is its own source; joining all of them by name is net labels' job (R10).
 */
function rail(level: 0 | 1) {
  const high = level === 1;
  return defineComponent<Record<string, never>, undefined>({
    type: high ? 'io/vcc' : 'io/gnd',
    name: high ? 'VCC' : 'GND',
    title: high ? 'Supply rail (VCC, logic 1)' : 'Ground (GND, logic 0)',
    keywords: high
      ? ['vcc', 'power', 'supply', '5v', 'rail', 'high', 'logic 1']
      : ['gnd', 'ground', 'rail', '0v', 'low', 'logic 0'],
    designatorPrefix: 'PWR',
    pins: [{ name: 'Y', dir: 'out', constant: level }],
    // VCC: a bar with the pin hanging below it; GND: the ground sign with the pin above it.
    symbol: {
      kind: high ? 'vcc' : 'gnd',
      width: 2,
      height: 1,
      pins: { Y: { side: high ? 'bottom' : 'top', offset: 1 } },
    },
    create: () => ({
      init: (ctx) => ctx.drive(0, strong(high ? Level.L1 : Level.L0), 0),
    }),
  });
}

export const vcc = rail(1);
export const gnd = rail(0);
