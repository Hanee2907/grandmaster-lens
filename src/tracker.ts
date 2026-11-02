// Works out which legal move was played from the squares that changed.
//
// Instead of recognising every piece (which needs a trained model and good
// lighting), we know the position before the move. A move only changes a few
// squares: two for a normal move, three for en passant and four for castling.
// So we score every legal move by how well its squares match the changes.

import type { Move, Square } from 'chess.js';

export function squareIndex(sq: Square): number {
  return (sq.charCodeAt(1) - 49) * 8 + (sq.charCodeAt(0) - 97);
}

export function indexSquare(i: number): Square {
  return (String.fromCharCode(97 + (i % 8)) + String.fromCharCode(49 + Math.floor(i / 8))) as Square;
}

/** Every square whose contents change when the move is played. */
export function touchedSquares(move: Move): Square[] {
  const squares: Square[] = [move.from, move.to];
  const rank = move.from[1];
  if (move.flags.includes('k')) squares.push(`h${rank}` as Square, `f${rank}` as Square);
  if (move.flags.includes('q')) squares.push(`a${rank}` as Square, `d${rank}` as Square);
  if (move.flags.includes('e')) squares.push(`${move.to[0]}${rank}` as Square);
  return squares;
}

export interface MoveMatch {
  move: Move;
  /** How clearly this move explains the changes (higher is clearer). */
  score: number;
}

/**
 * Picks the legal move that best explains the changes.
 * Returns null when nothing changed enough, or when the changes don't look
 * like any single legal move (for example a hand still resting on the board).
 *
 * Squares outside the move are allowed to change a little, because a tall
 * piece seen at an angle can lean over the square behind it.
 */
export function matchMove(
  changes: number[],
  legal: Move[],
  threshold = 16,
): MoveMatch | null {
  let best: MoveMatch | null = null;
  for (const move of legal) {
    const touched = new Set(touchedSquares(move).map(squareIndex));
    let weakestTouched = Infinity;
    let strongestOther = 0;
    for (let i = 0; i < 64; i++) {
      if (touched.has(i)) weakestTouched = Math.min(weakestTouched, changes[i]);
      else strongestOther = Math.max(strongestOther, changes[i]);
    }
    if (weakestTouched < threshold) continue;
    const score = weakestTouched - 0.6 * strongestOther;
    if (score < threshold * 0.4) continue;
    // Promotions share squares; prefer the queen.
    const better =
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) < 1e-9 && move.promotion === 'q');
    if (better) best = { move, score };
  }
  return best;
}

/** Changed squares above the threshold, strongest first (used for status messages). */
export function changedSquares(changes: number[], threshold = 16): Square[] {
  return changes
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c >= threshold)
    .sort((a, b) => b.c - a.c)
    .map((x) => indexSquare(x.i));
}
