import { defineComponent, Level, strong } from '../../core';

/**
 * Power rail symbols: a connection to VCC (logic 1) or GND (logic 0), driven strong from t = 0.
 * Every VCC symbol is on the net `VCC` and every GND symbol on `GND`, joined by name like net
 * labels (a label `VCC` joins it too). The pin is marked `constant`, so the symbols on one net
 * count as one source for the design checks (VCC to GND is a short).
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
    pins: [{ name: 'Y', dir: 'out', constant: level, net: high ? 'VCC' : 'GND' }],
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
