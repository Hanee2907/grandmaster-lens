// The digital twin of the real board. Click a piece, then a square, to play or
// correct a move by hand.

import type { Chess, Square } from 'chess.js';
import { pieceUrl } from '../pieces';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface BoardArrow {
  from: Square;
  to: Square;
  kind: 'best' | 'played';
}

export class BoardView {
  readonly el: HTMLElement;
  private grid: HTMLElement;
  private arrows: SVGSVGElement;
  private selected: Square | null = null;
  flipped = false;

  constructor(
    private onMove: (from: Square, to: Square) => void,
    private legalTargets: (from: Square) => Square[],
  ) {
    this.el = document.createElement('div');
    this.el.className = 'board';
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    this.arrows = document.createElementNS(SVG_NS, 'svg');
    this.arrows.setAttribute('class', 'board-arrows');
    this.arrows.setAttribute('viewBox', '0 0 8 8');
    this.arrows.innerHTML = `<defs>
      <marker id="head-best" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--arrow-best)"/></marker>
      <marker id="head-played" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--arrow-played)"/></marker>
    </defs>`;
    this.el.append(this.grid, this.arrows);
    this.grid.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-sq]');
      if (cell) this.onClick(cell.dataset.sq as Square);
    });
  }

  private squaresInOrder(): Square[] {
    const out: Square[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const file = this.flipped ? 7 - col : col;
        const rank = this.flipped ? row : 7 - row;
        out.push((String.fromCharCode(97 + file) + (rank + 1)) as Square);
      }
    }
    return out;
  }

  private onClick(sq: Square): void {
    if (this.selected && this.selected !== sq && this.legalTargets(this.selected).includes(sq)) {
      const from = this.selected;
      this.selected = null;
      this.onMove(from, sq);
      return;
    }
    this.selected = this.legalTargets(sq).length > 0 && this.selected !== sq ? sq : null;
    this.refreshSelection();
  }

  private refreshSelection(): void {
    const targets = this.selected ? this.legalTargets(this.selected) : [];
    for (const cell of this.grid.children as HTMLCollectionOf<HTMLElement>) {
      const sq = cell.dataset.sq as Square;
      cell.classList.toggle('is-selected', sq === this.selected);
      cell.classList.toggle('is-target', targets.includes(sq));
    }
  }

  render(chess: Chess, lastMove: { from: Square; to: Square } | null, arrows: BoardArrow[]): void {
    this.selected = null;
    const frag = document.createDocumentFragment();
    const inCheck = chess.inCheck() ? chess.turn() : null;
    this.squaresInOrder().forEach((sq, i) => {
      const cell = document.createElement('div');
      const file = sq.charCodeAt(0) - 97;
      const rank = sq.charCodeAt(1) - 49;
      cell.className = 'sq ' + ((file + rank) % 2 === 0 ? 'dark' : 'light');
      cell.dataset.sq = sq;
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) cell.classList.add('is-last');
      const piece = chess.get(sq);
      if (piece) {
        const img = document.createElement('img');
        img.src = pieceUrl(piece.color, piece.type);
        img.alt = '';
        img.draggable = false;
        cell.append(img);
        if (piece.type === 'k' && piece.color === inCheck) cell.classList.add('is-check');
      }
      if (i % 8 === 0) cell.append(label('rank', String(rank + 1)));
      if (i >= 56) cell.append(label('file', sq[0]));
      frag.append(cell);
    });
    this.grid.replaceChildren(frag);
    this.drawArrows(arrows);
  }

  private center(sq: Square): { x: number; y: number } {
    const file = sq.charCodeAt(0) - 97;
    const rank = sq.charCodeAt(1) - 49;
    const col = this.flipped ? 7 - file : file;
    const row = this.flipped ? rank : 7 - rank;
    return { x: col + 0.5, y: row + 0.5 };
  }

  drawArrows(arrows: BoardArrow[]): void {
    this.arrows.querySelectorAll('line').forEach((l) => l.remove());
    for (const a of arrows) {
      const p = this.center(a.from);
      const q = this.center(a.to);
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const shorten = 0.32 / len;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(p.x));
      line.setAttribute('y1', String(p.y));
      line.setAttribute('x2', String(q.x - (q.x - p.x) * shorten));
      line.setAttribute('y2', String(q.y - (q.y - p.y) * shorten));
      line.setAttribute('class', 'arrow arrow-' + a.kind);
      line.setAttribute('marker-end', `url(#head-${a.kind})`);
      this.arrows.append(line);
    }
  }
}

function label(kind: string, text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'coord coord-' + kind;
  s.textContent = text;
  return s;
}
