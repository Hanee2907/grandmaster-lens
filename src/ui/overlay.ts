// Drawing on top of the camera view. Shapes are built in flat board space and
// then projected, so arrows and highlights lean with the real board.

import type { Square } from 'chess.js';
import { apply, type Mat3, type Pt } from '../geometry';

export const CORNER_NAMES = ['a1', 'h1', 'h8', 'a8'];

function squareXY(sq: Square): { file: number; row: number } {
  return { file: sq.charCodeAt(0) - 97, row: 7 - (sq.charCodeAt(1) - 49) };
}

function polygon(ctx: CanvasRenderingContext2D, h: Mat3, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = apply(h, p);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  });
  ctx.closePath();
}

export function drawGrid(ctx: CanvasRenderingContext2D, h: Mat3, strong: boolean): void {
  ctx.save();
  ctx.strokeStyle = strong ? 'rgba(227, 180, 90, 0.95)' : 'rgba(227, 180, 90, 0.35)';
  ctx.lineWidth = strong ? 2 : 1;
  for (let i = 0; i <= 8; i++) {
    for (const [a, b] of [
      [{ x: i, y: 0 }, { x: i, y: 8 }],
      [{ x: 0, y: i }, { x: 8, y: i }],
    ]) {
      const p = apply(h, a);
      const q = apply(h, b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function fillSquare(ctx: CanvasRenderingContext2D, h: Mat3, sq: Square, color: string): void {
  const { file, row } = squareXY(sq);
  ctx.save();
  ctx.fillStyle = color;
  polygon(ctx, h, [
    { x: file, y: row },
    { x: file + 1, y: row },
    { x: file + 1, y: row + 1 },
    { x: file, y: row + 1 },
  ]);
  ctx.fill();
  ctx.restore();
}

/** An arrow lying flat on the board from one square to another. */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  h: Mat3,
  from: Square,
  to: Square,
  color: string,
): void {
  const a = squareXY(from);
  const b = squareXY(to);
  const p = { x: a.file + 0.5, y: a.row + 0.5 };
  const q = { x: b.file + 0.5, y: b.row + 0.5 };
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const ux = (q.x - p.x) / len;
  const uy = (q.y - p.y) / len;
  const nx = -uy;
  const ny = ux;
  const shaft = 0.11;
  const head = 0.3;
  const headLen = 0.42;
  const base = { x: q.x - ux * headLen, y: q.y - uy * headLen };
  const start = { x: p.x + ux * 0.18, y: p.y + uy * 0.18 };
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1.5;
  polygon(ctx, h, [
    { x: start.x + nx * shaft, y: start.y + ny * shaft },
    { x: base.x + nx * shaft, y: base.y + ny * shaft },
    { x: base.x + nx * head, y: base.y + ny * head },
    q,
    { x: base.x - nx * head, y: base.y - ny * head },
    { x: base.x - nx * shaft, y: base.y - ny * shaft },
    { x: start.x - nx * shaft, y: start.y - ny * shaft },
  ]);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawCorners(ctx: CanvasRenderingContext2D, corners: Pt[], active: number): void {
  ctx.save();
  if (corners.length >= 2) {
    ctx.strokeStyle = 'rgba(227, 180, 90, 0.9)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    if (corners.length === 4) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  corners.forEach((c, i) => {
    ctx.fillStyle = i === active ? '#e3b45a' : 'rgba(18, 24, 21, 0.85)';
    ctx.strokeStyle = '#e3b45a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = i === active ? '#121815' : '#f3e6c8';
    ctx.fillText(CORNER_NAMES[i], c.x, c.y + 0.5);
  });
  ctx.restore();
}
