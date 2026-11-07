/**
 * What the Probe tool and the canvas context menu probe at a point (R13): a pin of a simulated
 * part by its pin reference (`U1.Y`), a wire or a net label by its net (its name, else a
 * driving pin on it), a bus line, bus label or bus entry's bus end by the bus's name. Pure, on
 * the scene. Spec: docs/editor.md#probing-from-the-canvas.
 */
import { type Point, Resolver } from '../circuit';
import type { ComponentRegistry } from '../core';
import { rectContainsPoint, segmentDistance2 } from './hit-test';
import type { Scene, ScenePart, ScenePin } from './scene';

/** A probe-able spot: the reference, and what to highlight while pointing at it. */
export interface ProbeSpot {
  readonly ref: string;
  /** The net's (or bus's) wires. */
  readonly wires: readonly string[];
  /** The pin tip pointed at, if any. */
  readonly pin?: Point;
}

/**
 * The spot at `point` (world cells, `tolerance` cells around pins and wires): a spot, the reason
 * it can't be probed, or undefined where nothing is. Bodies of parts are no spot, except those
 * of net labels, bus labels and bus entries (their name is the point).
 */
export function probeSpotAt(
  scene: Scene,
  registry: ComponentRegistry,
  point: Point,
  tolerance: number,
): ProbeSpot | string | undefined {
  let best:
    | { part?: ScenePart; pin?: ScenePin; wire?: string; net: string; bus: boolean }
    | undefined;
  let bestDistance = tolerance * tolerance;
  for (let i = scene.parts.length - 1; i >= 0; i--) {
    const part = scene.parts[i]!;
    if (rectContainsPoint(part.body, point)) {
      const pin = part.pins[0];
      if (!part.definition?.schematicOnly || !pin?.net) return undefined;
      best = { part, pin, net: pin.net, bus: pin.bus };
      bestDistance = -1;
      break;
    }
  }
  if (bestDistance >= 0) {
    for (const part of scene.parts) {
      if (!rectContainsPoint(part.bounds, point, tolerance)) continue;
      for (const pin of part.pins) {
        const d = segmentDistance2(point, pin.base, pin.at);
        if (d <= bestDistance && pin.net !== undefined) {
          best = { part, pin, net: pin.net, bus: pin.bus };
          bestDistance = d;
        }
      }
    }
    for (const wire of scene.wires) {
      const d = segmentDistance2(point, wire.from, wire.to);
      if (d < bestDistance) {
        best = { wire: wire.id, net: wire.net, bus: wire.bus };
        bestDistance = d;
      }
    }
  }
  if (!best) return undefined;
  const wires = scene.wires
    .filter((w) => w.bus === best.bus && w.net === best.net)
    .map((w) => w.id);
  const pin = best.pin && { pin: best.pin.at };
  if (best.bus) {
    const name = scene.compiled.buses.find((b) => b.id === best.net)?.names[0];
    return name === undefined
      ? 'This bus has no name: give it a bus label to probe it.'
      : { ref: name, wires, ...pin };
  }
  if (best.part && best.pin && !best.part.definition?.schematicOnly) {
    return { ref: `${best.part.id}.${best.pin.name}`, wires, ...pin };
  }
  const ref = new Resolver(scene.compiled, registry).netReference(best.net);
  return ref === undefined
    ? 'This wire connects no pin: name it with a net label to probe it.'
    : { ref, wires, ...pin };
}
