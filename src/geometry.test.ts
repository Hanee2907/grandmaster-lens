import { describe, expect, it } from 'vitest';
import { apply, boardToImage, homography, invert, isConvexQuad, squareCenter } from './geometry';

const corners = [
  { x: 92, y: 438 },
  { x: 556, y: 446 },
  { x: 472, y: 118 },
  { x: 168, y: 112 },
];

describe('homography', () => {
  it('maps every source corner onto its target corner', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const h = homography(src, corners);
    src.forEach((p, i) => {
      const q = apply(h, p);
      expect(q.x).toBeCloseTo(corners[i].x, 6);
      expect(q.y).toBeCloseTo(corners[i].y, 6);
    });
  });

  it('round-trips through its inverse', () => {
    const h = boardToImage(corners);
    const back = invert(h);
    for (const p of [{ x: 3.5, y: 2.5 }, { x: 0.2, y: 7.9 }, { x: 8, y: 0 }]) {
      const q = apply(back, apply(h, p));
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
    }
  });

  it('puts a1 near the a1 corner and h8 near the h8 corner', () => {
    const h = boardToImage(corners);
    const a1 = apply(h, squareCenter(0, 0));
    const h8 = apply(h, squareCenter(7, 7));
    expect(a1.x).toBeLessThan(200);
    expect(a1.y).toBeGreaterThan(380);
    expect(h8.x).toBeGreaterThan(420);
    expect(h8.y).toBeLessThan(160);
  });
});

describe('isConvexQuad', () => {
  it('accepts a board outline and rejects a crossed one', () => {
    expect(isConvexQuad(corners)).toBe(true);
    expect(isConvexQuad([corners[0], corners[2], corners[1], corners[3]])).toBe(false);
  });
});
