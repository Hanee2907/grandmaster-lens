// Turns camera frames into "what each square looks like" and watches for changes.
//
// Every square is sampled on a small grid of points (inside the square, away from
// the edges), which gives it a colour signature. Comparing signatures between
// frames tells us when the scene is still (no hand over the board) and which
// squares changed since the last accepted position.

import { apply, type Mat3 } from './geometry';

const GRID = 7;
const MARGIN = 0.2;
const POINTS = GRID * GRID;

/** 64 squares × POINTS samples × RGB, square index = rank * 8 + file (a1 = 0). */
export type Signature = Float32Array;

/** Precomputed pixel offsets for every sample point, for one calibration. */
export class SquareSampler {
  private offsets: Int32Array;

  constructor(h: Mat3, readonly width: number, readonly height: number) {
    this.offsets = new Int32Array(64 * POINTS);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = rank * 8 + file;
        for (let gy = 0; gy < GRID; gy++) {
          for (let gx = 0; gx < GRID; gx++) {
            const bx = file + MARGIN + ((1 - 2 * MARGIN) * gx) / (GRID - 1);
            const by = 7 - rank + MARGIN + ((1 - 2 * MARGIN) * gy) / (GRID - 1);
            const p = apply(h, { x: bx, y: by });
            const x = Math.min(width - 1, Math.max(0, Math.round(p.x)));
            const y = Math.min(height - 1, Math.max(0, Math.round(p.y)));
            this.offsets[sq * POINTS + gy * GRID + gx] = (y * width + x) * 4;
          }
        }
      }
    }
  }

  sample(frame: ImageData): Signature {
    const sig = new Float32Array(64 * POINTS * 3);
    const d = frame.data;
    for (let i = 0; i < this.offsets.length; i++) {
      const o = this.offsets[i];
      sig[i * 3] = d[o];
      sig[i * 3 + 1] = d[o + 1];
      sig[i * 3 + 2] = d[o + 2];
    }
    return sig;
  }
}

/**
 * How much each square changed between two signatures (0 = identical).
 * The median change is subtracted so a lighting change across the whole
 * board is not mistaken for moves.
 */
export function squareChanges(a: Signature, b: Signature): number[] {
  const raw: number[] = [];
  for (let sq = 0; sq < 64; sq++) {
    let total = 0;
    const start = sq * POINTS * 3;
    for (let i = start; i < start + POINTS * 3; i++) total += Math.abs(a[i] - b[i]);
    raw.push(total / (POINTS * 3));
  }
  const median = [...raw].sort((x, y) => x - y)[32];
  return raw.map((v) => Math.max(0, v - median));
}

export interface StillnessUpdate {
  /** Largest square change compared with the previous frame. */
  motion: number;
  /** True once the view has stayed still for long enough. */
  still: boolean;
  /** Something large (usually a hand) is over the board. */
  busy: boolean;
}

/** Decides when the camera view has settled after a hand moves a piece. */
export class StillnessDetector {
  private prev: Signature | null = null;
  private stillSince = 0;

  constructor(
    private motionThreshold = 9,
    private settleMs = 650,
  ) {}

  update(sig: Signature, now: number): StillnessUpdate {
    let motion = 0;
    let moving = 0;
    if (this.prev) {
      const changes = squareChanges(this.prev, sig);
      for (const c of changes) {
        motion = Math.max(motion, c);
        if (c > this.motionThreshold) moving++;
      }
    }
    this.prev = sig;
    if (motion > this.motionThreshold) this.stillSince = now;
    return {
      motion,
      still: now - this.stillSince >= this.settleMs,
      busy: moving >= 3,
    };
  }

  reset(): void {
    this.prev = null;
    this.stillSince = performance.now();
  }
}
