// A pretend camera: a wooden board on a table, seen at an angle, with a hand
// that reaches in and plays moves. It lets anyone try the app without a real
// board, and gives the vision code realistic frames to work on.

import { Chess, type Move } from 'chess.js';
import { apply, boardToImage, invert, type Mat3, type Pt } from './geometry';

export const DEMO_WIDTH = 640;
export const DEMO_HEIGHT = 480;

/** Where the board's corners (a1, h1, h8, a8) appear in the demo picture. */
export const DEMO_CORNERS: Pt[] = [
  { x: 92, y: 438 },
  { x: 556, y: 446 },
  { x: 472, y: 118 },
  { x: 168, y: 112 },
];

/** Morphy vs Duke Karl and Count Isouard, Paris 1858: "The Opera Game". */
const OPERA_GAME =
  'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 ' +
  'Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#';

const UNIT = 64;
const BORDER = 0.45;
const TEX = Math.round((8 + 2 * BORDER) * UNIT);

const REACH_MS = 650;
const CARRY_MS = 700;
const LEAVE_MS = 600;
const MOVE_MS = REACH_MS + CARRY_MS + LEAVE_MS;

export class DemoCamera {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture = document.createElement('canvas');
  private boardToImg: Mat3 = boardToImage(DEMO_CORNERS);
  private imgToBoard: Mat3 = invert(this.boardToImg);
  private game = new Chess();
  private script: string[] = [];
  private cached: { fen: string; image: ImageData } | null = null;
  private table: ImageData;
  private anim: { move: Move; start: number } | null = null;
  private nextAt = 0;
  playing = false;
  pauseMs = 2600;

  constructor(private pieces: Map<string, HTMLImageElement>) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = DEMO_WIDTH;
    this.canvas.height = DEMO_HEIGHT;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.texture.width = TEX;
    this.texture.height = TEX;
    const parser = new Chess();
    parser.loadPgn(OPERA_GAME);
    this.script = parser.history();
    this.table = this.paintTable();
  }

  /** Moves the demo plays, in SAN, and how many have been played. */
  get progress(): { played: number; total: number } {
    return { played: this.game.history().length, total: this.script.length };
  }

  reset(): void {
    this.game = new Chess();
    this.anim = null;
    this.cached = null;
    this.nextAt = performance.now() + 1200;
  }

  /** Plays one move right away (the "Next move" button). */
  step(now: number): void {
    if (!this.anim) this.startNextMove(now);
  }

  /** Draws the current frame. Call once per animation frame. */
  render(now: number): void {
    if (this.playing && !this.anim && now >= this.nextAt) this.startNextMove(now);

    let t = 0;
    let shown = this.game;
    if (this.anim) {
      t = now - this.anim.start;
      if (t >= MOVE_MS) {
        this.anim = null;
        this.nextAt = now + this.pauseMs;
      } else if (t < REACH_MS + CARRY_MS * 0.5) {
        shown = new Chess(this.anim.move.before);
      }
    }

    const fen = shown.fen().split(' ')[0];
    if (!this.cached || this.cached.fen !== fen) {
      this.cached = { fen, image: this.warp(shown) };
    }
    this.ctx.putImageData(this.cached.image, 0, 0);
    if (this.anim) this.drawHand(this.anim.move, t);
  }

  private startNextMove(now: number): void {
    const san = this.script[this.game.history().length];
    if (!san) {
      this.playing = false;
      return;
    }
    const move = this.game.move(san);
    this.anim = { move, start: now };
  }

  private paintTable(): ImageData {
    const c = document.createElement('canvas');
    c.width = DEMO_WIDTH;
    c.height = DEMO_HEIGHT;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(320, 200, 60, 320, 260, 520);
    grad.addColorStop(0, '#5a4a3c');
    grad.addColorStop(1, '#231b16');
    g.fillStyle = grad;
    g.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
    // Wood grain on the table.
    g.globalAlpha = 0.08;
    for (let y = 0; y < DEMO_HEIGHT; y += 3) {
      g.fillStyle = Math.sin(y * 0.11) + Math.sin(y * 0.031) > 0.6 ? '#000' : '#fff';
      g.fillRect(0, y, DEMO_WIDTH, 1);
    }
    return g.getImageData(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
  }

  /** Paints the board seen from straight above. */
  private paintTexture(position: Chess): ImageData {
    const g = this.texture.getContext('2d', { willReadFrequently: true })!;
    const b = BORDER * UNIT;
    g.fillStyle = '#4e2e1b';
    g.fillRect(0, 0, TEX, TEX);
    g.fillStyle = '#6b4128';
    g.fillRect(b * 0.35, b * 0.35, TEX - b * 0.7, TEX - b * 0.7);
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        g.fillStyle = (r + f) % 2 === 0 ? '#ecd9b6' : '#b07d4f';
        g.fillRect(b + f * UNIT, b + r * UNIT, UNIT, UNIT);
      }
    }
    const board = position.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (!p) continue;
        const img = this.pieces.get(p.color + p.type.toUpperCase());
        if (img) g.drawImage(img, b + f * UNIT + 3, b + r * UNIT + 3, UNIT - 6, UNIT - 6);
      }
    }
    return g.getImageData(0, 0, TEX, TEX);
  }

  /** Projects the top-down board into the angled camera view. */
  private warp(position: Chess): ImageData {
    const tex = this.paintTexture(position).data;
    const out = new ImageData(new Uint8ClampedArray(this.table.data), DEMO_WIDTH, DEMO_HEIGHT);
    const o = out.data;
    const h = this.imgToBoard;
    for (let y = 0; y < DEMO_HEIGHT; y++) {
      for (let x = 0; x < DEMO_WIDTH; x++) {
        const w = h[6] * x + h[7] * y + h[8];
        const bx = (h[0] * x + h[1] * y + h[2]) / w;
        const by = (h[3] * x + h[4] * y + h[5]) / w;
        if (bx < -BORDER || by < -BORDER || bx >= 8 + BORDER || by >= 8 + BORDER) continue;
        const tx = Math.floor((bx + BORDER) * UNIT);
        const ty = Math.floor((by + BORDER) * UNIT);
        const ti = (ty * TEX + tx) * 4;
        const oi = (y * DEMO_WIDTH + x) * 4;
        // A soft light from the top left of the board.
        const shade = 1.06 - 0.12 * ((bx + by) / 16);
        o[oi] = tex[ti] * shade;
        o[oi + 1] = tex[ti + 1] * shade;
        o[oi + 2] = tex[ti + 2] * shade;
      }
    }
    return out;
  }

  private squareToImage(sq: string): Pt {
    const file = sq.charCodeAt(0) - 97;
    const rank = sq.charCodeAt(1) - 49;
    return apply(this.boardToImg, { x: file + 0.5, y: 7 - rank + 0.5 });
  }

  /** Draws an arm reaching in from the bottom edge to play the move. */
  private drawHand(move: Move, t: number): void {
    const from = this.squareToImage(move.from);
    const to = this.squareToImage(move.to);
    const rest = { x: DEMO_WIDTH * 0.62, y: DEMO_HEIGHT + 120 };
    let tip: Pt;
    if (t < REACH_MS) tip = lerp(rest, from, ease(t / REACH_MS));
    else if (t < REACH_MS + CARRY_MS) tip = lerp(from, to, ease((t - REACH_MS) / CARRY_MS));
    else tip = lerp(to, rest, ease((t - REACH_MS - CARRY_MS) / LEAVE_MS));

    const g = this.ctx;
    const shoulder = { x: tip.x + 150, y: DEMO_HEIGHT + 60 };
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = '#3c5a8a';
    g.lineWidth = 64;
    g.beginPath();
    g.moveTo(shoulder.x, shoulder.y);
    g.lineTo(tip.x + 40, tip.y + 46);
    g.stroke();
    g.fillStyle = '#c99872';
    g.beginPath();
    g.ellipse(tip.x + 14, tip.y + 18, 30, 36, -0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#b8845f';
    g.beginPath();
    g.ellipse(tip.x - 6, tip.y - 2, 10, 20, -0.7, 0, Math.PI * 2);
    g.fill();

    // While carrying, show the piece between the fingers.
    if (t >= REACH_MS && t < REACH_MS + CARRY_MS) {
      const img = this.pieces.get(move.color + move.piece.toUpperCase());
      if (img) g.drawImage(img, tip.x - 26, tip.y - 40, 44, 44);
    }
    g.restore();
  }
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
