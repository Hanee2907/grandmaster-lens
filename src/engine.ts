// Talks to Stockfish (compiled to WebAssembly) running in a Web Worker over UCI.

export interface Analysis {
  fen: string;
  depth: number;
  /** Score in centipawns from White's point of view. Mates are ±(100000 - plies). */
  score: number;
  /** Mate in N moves (positive = White mates), or null. */
  mate: number | null;
  /** Principal variation in UCI notation, e.g. ["e2e4", "e7e5"]. */
  pv: string[];
  best: string | null;
  done: boolean;
}

type Listener = (a: Analysis) => void;

export class Engine {
  private worker: Worker;
  private ready: Promise<void>;
  private current: { fen: string; whiteToMove: boolean; listener: Listener; last: Analysis } | null = null;
  private pending: { fen: string; depth: number; listener: Listener } | null = null;
  private searching = false;

  constructor(url: string) {
    this.worker = new Worker(url);
    this.ready = new Promise((resolve) => {
      const onReady = (e: MessageEvent) => {
        if (String(e.data) === 'readyok') {
          this.worker.removeEventListener('message', onReady);
          resolve();
        }
      };
      this.worker.addEventListener('message', onReady);
    });
    this.worker.addEventListener('message', (e) => this.onLine(String(e.data)));
    this.send('uci');
    this.send('setoption name Hash value 32');
    this.send('isready');
  }

  private send(cmd: string): void {
    this.worker.postMessage(cmd);
  }

  /** Analyses a position, replacing any search already running. */
  async analyse(fen: string, depth: number, listener: Listener): Promise<void> {
    await this.ready;
    this.pending = { fen, depth, listener };
    if (this.searching) {
      this.send('stop');
      return;
    }
    this.startPending();
  }

  stop(): void {
    this.pending = null;
    if (this.searching) this.send('stop');
  }

  private startPending(): void {
    const job = this.pending;
    if (!job) return;
    this.pending = null;
    const whiteToMove = job.fen.split(' ')[1] !== 'b';
    this.current = {
      fen: job.fen,
      whiteToMove,
      listener: job.listener,
      last: { fen: job.fen, depth: 0, score: 0, mate: null, pv: [], best: null, done: false },
    };
    this.searching = true;
    this.send('position fen ' + job.fen);
    this.send('go depth ' + job.depth);
  }

  private onLine(line: string): void {
    const cur = this.current;
    if (!cur) return;
    if (line.startsWith('info') && line.includes(' pv ') && !line.includes('multipv 2')) {
      const depth = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0);
      const cp = / score cp (-?\d+)/.exec(line);
      const mate = / score mate (-?\d+)/.exec(line);
      const pv = line.split(' pv ')[1].trim().split(/\s+/);
      const sign = cur.whiteToMove ? 1 : -1;
      let score = 0;
      let mateIn: number | null = null;
      if (cp) score = sign * Number(cp[1]);
      if (mate) {
        const m = Number(mate[1]);
        mateIn = sign * m;
        score = sign * Math.sign(m || 1) * (100000 - Math.abs(m) * 2);
      }
      cur.last = { fen: cur.fen, depth, score, mate: mateIn, pv, best: pv[0] ?? null, done: false };
      cur.listener(cur.last);
    } else if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      this.searching = false;
      const finished = { ...cur.last, best: best && best !== '(none)' ? best : null, done: true };
      this.current = null;
      if (!this.pending) cur.listener(finished);
      this.startPending();
    }
  }
}

/** Human-friendly score, e.g. "+1.4" or "M3". */
export function formatScore(a: Pick<Analysis, 'score' | 'mate'>): string {
  if (a.mate === 0) return a.score > 0 ? '1–0' : '0–1';
  if (a.mate !== null) return (a.mate > 0 ? '' : '-') + 'M' + Math.abs(a.mate);
  const pawns = a.score / 100;
  return (pawns > 0 ? '+' : '') + pawns.toFixed(1);
}

/** Winning chances for White between 0 and 1 (same curve Lichess uses). */
export function whiteWinChance(score: number): number {
  const clamped = Math.max(-2000, Math.min(2000, score));
  return 1 / (1 + Math.exp(-0.00368208 * clamped));
}
