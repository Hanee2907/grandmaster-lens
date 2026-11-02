// Grades moves and writes coaching hints from the engine's evaluations.

import type { Chess, Color, Move, PieceSymbol, Square } from 'chess.js';
import { whiteWinChance } from './engine';

export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const GRADE_LABEL: Record<Grade, string> = {
  best: 'Best',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

export interface GradedMove {
  mover: Color;
  grade: Grade;
  /** Drop in winning chances for the player who moved, 0..1. */
  loss: number;
  /** Move accuracy 0..100 (Lichess formula). */
  accuracy: number;
}

/**
 * Grades a move from the evaluation before and after it (both from White's
 * point of view). Grading uses winning chances rather than raw centipawns, so
 * dropping a pawn in a won position counts for less than in an equal one.
 */
export function gradeMove(
  mover: Color,
  scoreBefore: number,
  scoreAfter: number,
  playedUci: string,
  bestUci: string | null,
): GradedMove {
  const before = whiteWinChance(scoreBefore);
  const after = whiteWinChance(scoreAfter);
  // Playing the engine's own choice loses nothing; any drop is just search noise.
  const playedBest = bestUci !== null && playedUci === bestUci;
  const loss = playedBest ? 0 : Math.max(0, mover === 'w' ? before - after : after - before);
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss * 100) - 3.1669));
  let grade: Grade;
  if (loss >= 0.3) grade = 'blunder';
  else if (loss >= 0.2) grade = 'mistake';
  else if (loss >= 0.1) grade = 'inaccuracy';
  else if (playedBest) grade = 'best';
  else grade = 'good';
  return { mover, grade, loss, accuracy };
}

export function moveToUci(m: Pick<Move, 'from' | 'to' | 'promotion'>): string {
  return m.from + m.to + (m.promotion ?? '');
}

export function uciParts(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: (uci[4] as PieceSymbol | undefined) || undefined,
  };
}

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** A gentle hint that points at the right piece without giving the move away. */
export function hintFor(chess: Chess, bestUci: string): string {
  const { from, to } = uciParts(bestUci);
  const piece = chess.get(from);
  if (!piece) return 'Look for active moves.';
  const target = chess.get(to);
  const name = PIECE_NAME[piece.type];
  if (target) return `Your ${name} on ${from} has a capture worth looking at.`;
  const verbose = chess.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
  if (verbose && verbose.san.includes('+')) return `Your ${name} on ${from} can give check.`;
  if (verbose && verbose.flags.includes('k')) return 'Is it time to castle?';
  return `Think about a move with your ${name} on ${from}.`;
}

/** Average accuracy for one side, or null when they haven't moved yet. */
export function averageAccuracy(graded: (GradedMove | null)[], side: Color): number | null {
  const own = graded.filter((g): g is GradedMove => g !== null && g.mover === side);
  if (own.length === 0) return null;
  return own.reduce((s, g) => s + g.accuracy, 0) / own.length;
}
