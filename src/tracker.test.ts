import { describe, expect, it } from 'vitest';
import { Chess, type Square } from 'chess.js';
import { matchMove, squareIndex } from './tracker';
import { gradeMove } from './coach';

/** A change map where only the given squares changed. */
function changes(squares: Square[], strength = 40, noise = 2): number[] {
  const c = new Array(64).fill(noise);
  for (const sq of squares) c[squareIndex(sq)] = strength;
  return c;
}

describe('matchMove', () => {
  it('finds a normal move from two changed squares', () => {
    const chess = new Chess();
    const m = matchMove(changes(['g1', 'f3']), chess.moves({ verbose: true }));
    expect(m?.move.san).toBe('Nf3');
  });

  it('tells e4 from e3 by which square changed', () => {
    const chess = new Chess();
    expect(matchMove(changes(['e2', 'e4']), chess.moves({ verbose: true }))?.move.san).toBe('e4');
    expect(matchMove(changes(['e2', 'e3']), chess.moves({ verbose: true }))?.move.san).toBe('e3');
  });

  it('recognises castling from four changed squares', () => {
    const chess = new Chess('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    const short = matchMove(changes(['e1', 'g1', 'h1', 'f1']), chess.moves({ verbose: true }));
    expect(short?.move.san).toBe('O-O');
    const long = matchMove(changes(['e1', 'c1', 'a1', 'd1']), chess.moves({ verbose: true }));
    expect(long?.move.san).toBe('O-O-O');
  });

  it('recognises en passant', () => {
    const chess = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const m = matchMove(changes(['e5', 'd6', 'd5']), chess.moves({ verbose: true }));
    expect(m?.move.san).toBe('exd6');
  });

  it('promotes to a queen by default', () => {
    const chess = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const m = matchMove(changes(['a7', 'a8']), chess.moves({ verbose: true }));
    expect(m?.move.promotion).toBe('q');
  });

  it('ignores tiny changes and changes that are not a legal move', () => {
    const chess = new Chess();
    expect(matchMove(changes(['e2', 'e4'], 6), chess.moves({ verbose: true }))).toBeNull();
    expect(matchMove(changes(['e2', 'e5']), chess.moves({ verbose: true }))).toBeNull();
  });

  it('rejects a frame where a hand still covers many squares', () => {
    const chess = new Chess();
    const c = changes(['e2', 'e4']);
    for (const sq of ['d3', 'd4', 'f3', 'f4', 'e3'] as Square[]) c[squareIndex(sq)] = 60;
    expect(matchMove(c, chess.moves({ verbose: true }))).toBeNull();
  });
});

describe('gradeMove', () => {
  it('calls a big drop a blunder and the engine move best', () => {
    expect(gradeMove('w', 50, -400, 'e2e4', 'd2d4').grade).toBe('blunder');
    expect(gradeMove('w', 30, 25, 'e2e4', 'e2e4').grade).toBe('best');
    expect(gradeMove('b', 0, 20, 'e7e5', 'c7c5').grade).toBe('good');
  });
});
