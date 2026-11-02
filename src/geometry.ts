// Perspective maths: maps the flat 8x8 board onto the tilted board the camera sees.
//
// Board space: x runs 0..8 from the a-file to the h-file, y runs 0..8 from the
// 8th rank (top) down to the 1st rank (bottom). So the outer corner next to a1
// is (0, 8) and the corner next to h8 is (8, 0).

export interface Pt {
  x: number;
  y: number;
}

/** Row-major 3x3 matrix. */
export type Mat3 = number[];

/** Corner order used everywhere: a1, h1, h8, a8. */
export const BOARD_CORNERS: Pt[] = [
  { x: 0, y: 8 },
  { x: 8, y: 8 },
  { x: 8, y: 0 },
  { x: 0, y: 0 },
];

/** Solves A·x = b with Gaussian elimination and partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error('Corners are degenerate');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * Homography that sends each src point to the matching dst point
 * (direct linear transform with h33 fixed to 1).
 */
export function homography(src: Pt[], dst: Pt[]): Mat3 {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(a, b), 1];
}

export function apply(h: Mat3, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function invert(h: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible');
  return [
    A / det, -(b * j - c * i) / det, (b * f - c * e) / det,
    B / det, (a * j - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * i - b * g) / det, (a * e - b * d) / det,
  ];
}

/** Board → image transform from the four image corners (a1, h1, h8, a8). */
export function boardToImage(corners: Pt[]): Mat3 {
  return homography(BOARD_CORNERS, corners);
}

/** Centre of a square in board space. file 0..7 = a..h, rank 0..7 = 1..8. */
export function squareCenter(file: number, rank: number): Pt {
  return { x: file + 0.5, y: 7 - rank + 0.5 };
}

/** True when the four points form a convex quadrilateral (a usable board outline). */
export function isConvexQuad(p: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    const c = p[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
