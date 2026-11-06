import { describe, expect, it } from 'vitest';
import {
  BASE_SCALE,
  type Camera,
  centerOn,
  DEFAULT_CAMERA,
  fitRect,
  MAX_FIT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  toScreen,
  toWorld,
  visibleRect,
  zoomAt,
  zoomPercent,
  zoomStep,
} from './camera';

const camera: Camera = { x: 10, y: -5, scale: 20 };

describe('camera transforms', () => {
  it('maps world to screen and back', () => {
    expect(toScreen(camera, [10, -5])).toEqual([0, 0]);
    expect(toScreen(camera, [12, -4])).toEqual([40, 20]);
    expect(toWorld(camera, [40, 20])).toEqual([12, -4]);
  });

  it('reports the visible world rectangle', () => {
    expect(visibleRect(camera, { width: 200, height: 100 })).toEqual({
      x: 10,
      y: -5,
      width: 10,
      height: 5,
    });
  });

  it('shows 100 % at the base scale', () => {
    expect(zoomPercent(DEFAULT_CAMERA)).toBe(100);
    expect(zoomPercent({ ...camera, scale: BASE_SCALE * 2 })).toBe(200);
  });
});

describe('panning', () => {
  it('moves the world with the pointer', () => {
    const moved = panBy(camera, 40, -20);
    // The world point that was at screen (0, 0) is now at (40, -20).
    expect(toScreen(moved, [10, -5])).toEqual([40, -20]);
    expect(moved.scale).toBe(camera.scale);
  });
});

describe('zooming', () => {
  it('keeps the world point under the anchor fixed', () => {
    const anchor = [73, 41] as const;
    const before = toWorld(camera, anchor);
    const zoomed = zoomAt(camera, 1.7, anchor);
    expect(zoomed.scale).toBeCloseTo(34);
    const after = toWorld(zoomed, anchor);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('clamps to the zoom limits', () => {
    expect(zoomAt(camera, 1000, [0, 0]).scale).toBe(MAX_SCALE);
    expect(zoomAt(camera, 0.0001, [0, 0]).scale).toBe(MIN_SCALE);
  });

  it('steps along the √2 ladder through 100 %', () => {
    const at100 = DEFAULT_CAMERA;
    const in1 = zoomStep(at100, 1, [0, 0]);
    expect(in1.scale).toBeCloseTo(BASE_SCALE * Math.SQRT2);
    expect(zoomStep(in1, 1, [0, 0]).scale).toBeCloseTo(BASE_SCALE * 2);
    expect(zoomStep(in1, -1, [0, 0]).scale).toBeCloseTo(BASE_SCALE);
    expect(zoomStep(at100, -1, [0, 0]).scale).toBeCloseTo(BASE_SCALE / Math.SQRT2);
  });

  it('steps from an arbitrary scale to the next ladder level', () => {
    const odd = { ...camera, scale: BASE_SCALE * 1.2 };
    expect(zoomStep(odd, 1, [0, 0]).scale).toBeCloseTo(BASE_SCALE * Math.SQRT2);
    expect(zoomStep(odd, -1, [0, 0]).scale).toBeCloseTo(BASE_SCALE);
  });
});

describe('fitting', () => {
  const viewport = { width: 800, height: 600 };

  it('centers a rectangle and fits it inside the padding', () => {
    const fitted = fitRect({ x: 0, y: 0, width: 100, height: 20 }, viewport, 50);
    expect(fitted.scale).toBe(7); // (800 − 2 × 50) / 100
    const [cx, cy] = toScreen(fitted, [50, 10]);
    expect(cx).toBeCloseTo(400);
    expect(cy).toBeCloseTo(300);
  });

  it('does not magnify a small rectangle beyond the fit limit', () => {
    expect(fitRect({ x: 0, y: 0, width: 2, height: 2 }, viewport).scale).toBe(MAX_FIT_SCALE);
  });

  it('centers a point', () => {
    const centered = centerOn([5, 5], viewport, 10);
    expect(toScreen(centered, [5, 5])).toEqual([400, 300]);
  });
});
