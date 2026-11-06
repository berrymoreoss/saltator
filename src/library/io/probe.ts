import { defineComponent } from '../../core';

/**
 * Logic probe: shows the level of the net it touches (0, 1, X or Z). Stateless — the renderer
 * reads the pin's level — and it only observes the net, so probing a floating bus is no mistake.
 */
export const probe = defineComponent<Record<string, never>, undefined>({
  type: 'io/probe',
  name: 'PROBE',
  title: 'Logic probe',
  keywords: ['probe', 'level', 'indicator', 'debug', 'measure', 'output'],
  pins: [{ name: 'A', dir: 'in', sense: true }],
  symbol: { kind: 'probe', width: 2, height: 2, pins: { A: { side: 'left', offset: 1 } } },
  create: () => ({}),
});
