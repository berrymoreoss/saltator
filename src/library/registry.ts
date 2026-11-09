import { Registry } from '../core';
import { chips74xx } from './74xx';
import { cpus } from './cpu';
import { graphics } from './draw';
import { hdlPart } from './hdl';
import { io } from './io';
import { memories } from './mem';
import { nets } from './net';
import { peripherals } from './periph';
import { primitives } from './primitives';
import { timers } from './timer';

/** A fresh registry with every built-in part, which can make a Verilog module's part too. */
export function createDefaultRegistry(): Registry {
  return new Registry(
    [
      ...primitives,
      ...io,
      ...nets,
      ...chips74xx,
      ...timers,
      ...memories,
      ...cpus,
      ...peripherals,
      ...graphics,
    ],
    { hdlPart },
  );
}
