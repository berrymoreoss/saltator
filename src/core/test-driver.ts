/**
 * The stimulus driver of test benches: core's part `Bench` drives a part's inputs with it, and
 * the circuit test benches (R15a) the ports of the circuit under test.
 */
import { defineComponent } from './component';
import type { Drive } from './logic';

/**
 * A tri-state source set through `sim.action(id, drive)` (a `Drive`), with zero delay. Starts
 * released (`Z`), so a net the test never sets reads as floating.
 */
export const testDriver = defineComponent({
  type: 'test/driver',
  name: 'DRV',
  title: 'Test driver',
  pins: [{ name: 'Y', dir: 'tristate' }],
  create: () => ({
    action(ctx, drive) {
      ctx.drive(0, drive as Drive, 0);
    },
  }),
});
