import './style.css';
import { Chess, validateFen, type Move, type PieceSymbol, type Square } from 'chess.js';
import { boardToImage, isConvexQuad, type Mat3, type Pt } from './geometry';
import { SquareSampler, StillnessDetector, squareChanges, type Signature } from './vision';
import { changedSquares, matchMove } from './tracker';
import { Engine, formatScore, whiteWinChance, type Analysis } from './engine';
import { averageAccuracy, GRADE_LABEL, gradeMove, hintFor, moveToUci, uciParts, type GradedMove } from './coach';
import { DemoCamera, DEMO_CORNERS, DEMO_HEIGHT, DEMO_WIDTH } from './simulator';
import { loadPieceImages } from './pieces';
import { BoardView, type BoardArrow } from './ui/board';
import { CORNER_NAMES, drawArrow, drawCorners, drawGrid, fillSquare } from './ui/overlay';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Source = { kind: 'demo'; demo: DemoCamera } | { kind: 'camera'; stream: MediaStream };
type Phase = 'off' | 'calibrate' | 'watch';
type CoachMode = 'best' | 'hint' | 'off';
type Tone = 'idle' | 'live' | 'busy' | 'setup' | 'warn';

const ANALYSIS_DEPTH = 18;
const GRADE_DEPTH = 12;
const PROCESS_EVERY_MS = 90;

const frame = $<HTMLCanvasElement>('frame');
const overlay = $<HTMLCanvasElement>('overlay');
const video = $<HTMLVideoElement>('video');
const frameCtx = frame.getContext('2d', { willReadFrequently: true })!;
const overlayCtx = overlay.getContext('2d')!;
const lens = $('lens');

const state = {
  chess: new Chess(),
  startFen: new Chess().fen(),
  source: null as Source | null,
  phase: 'off' as Phase,
  corners: [] as Pt[],
  h: null as Mat3 | null,
  sampler: null as SquareSampler | null,
  stillness: new StillnessDetector(),
  reference: null as Signature | null,
  needsReference: true,
  unreadable: { since: 0, squares: [] as Square[] },
  flash: null as { squares: Square[]; until: number } | null,
  coach: 'best' as CoachMode,
  revealed: false,
  analysis: null as Analysis | null,
  evals: new Map<string, Analysis>(),
  graded: [] as (GradedMove | null)[],
  pendingGrade: null as { index: number; before: string; after: string; move: Move } | null,
  dragging: -1,
  lastProcess: 0,
};

const engine = new Engine(`${import.meta.env.BASE_URL}engine/stockfish.js`);
const boardView = new BoardView(
  (from, to) => playMove(from, to, undefined, 'board'),
  (from) => state.chess.moves({ square: from, verbose: true }).map((m) => m.to),
);
$('board-wrap').append(boardView.el);

let pieces: Map<string, HTMLImageElement> | null = null;
const piecesReady = loadPieceImages().then((p) => (pieces = p));

// ---------- Status and hints ----------

function setStatus(text: string, tone: Tone): void {
  const el = $('status');
  if (el.textContent !== text) el.textContent = text;
  el.dataset.tone = tone;
}

function setHint(html: string): void {
  $('lens-hint').innerHTML = html;
}

function show(id: string, visible: boolean): void {
  $(id).hidden = !visible;
}

// ---------- Sources ----------

function sizeFrame(width: number, height: number): void {
  for (const c of [frame, overlay]) {
    c.width = width;
    c.height = height;
  }
  lens.style.aspectRatio = `${width} / ${height}`;
}

async function startDemo(): Promise<void> {
  await piecesReady;
  stopSource();
  const demo = new DemoCamera(pieces!);
  state.source = { kind: 'demo', demo };
  sizeFrame(DEMO_WIDTH, DEMO_HEIGHT);
  newGame();
  demo.reset();
  state.corners = DEMO_CORNERS.map((c) => ({ ...c }));
  enterCalibration();
  setHint('The demo board is already lined up: the four handles sit on the corners. Press <b>Start watching</b>.');
}

async function startCamera(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('This browser has no camera access', 'warn');
    return;
  }
  setStatus('Asking for the camera…', 'setup');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch {
    setStatus('Camera blocked. Allow it in the browser, or try the demo board', 'warn');
    return;
  }
  stopSource();
  video.srcObject = stream;
  await video.play();
  const scale = 640 / (video.videoWidth || 640);
  sizeFrame(640, Math.round((video.videoHeight || 480) * scale));
  state.source = { kind: 'camera', stream };
  state.corners = [];
  enterCalibration();
}

function stopSource(): void {
  const src = state.source;
  if (src?.kind === 'camera') src.stream.getTracks().forEach((t) => t.stop());
  if (src?.kind === 'demo') src.demo.playing = false;
  state.source = null;
  video.srcObject = null;
}

function closeLens(): void {
  stopSource();
  state.phase = 'off';
  show('lens-empty', true);
  show('lens-bar', false);
  delete lens.dataset.calibrating;
  frameCtx.clearRect(0, 0, frame.width, frame.height);
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  setStatus('Choose a board to start', 'idle');
}

// ---------- Calibration ----------

function enterCalibration(): void {
  state.phase = 'calibrate';
  lens.dataset.calibrating = '';
  show('lens-empty', false);
  show('lens-bar', true);
  updateCalibrationUi();
}

function updateCalibrationUi(): void {
  const n = state.corners.length;
  const ready = n === 4 && isConvexQuad(state.corners);
  state.h = ready ? boardToImage(state.corners) : null;
  show('btn-start', ready);
  show('btn-rotate', n === 4);
  show('btn-recalibrate', false);
  show('btn-play', false);
  show('btn-step', false);
  setStatus(ready ? 'Board found' : `Calibrating: tap corner ${Math.min(n + 1, 4)} of 4`, 'setup');
  if (n < 4) {
    const where = [
      "next to White's left-hand rook",
      "next to White's right-hand rook",
      "next to Black's left-hand rook (from White's side, top right)",
      'the last one, top left',
    ][n];
    setHint(`Tap the outer corner of the playing squares ${where}: <b>${CORNER_NAMES[n]}</b>.`);
  } else if (state.source?.kind === 'camera') {
    setHint(
      ready
        ? 'Drag the handles to fine-tune. If the labels are on the wrong corners, press <b>Rotate corners</b>. Then set up the pieces and press <b>Start watching</b>.'
        : 'Those corners cross over. Drag the handles so they go round the board in order.',
    );
  }
}

function startWatching(): void {
  if (!state.h) return;
  state.sampler = new SquareSampler(state.h, frame.width, frame.height);
  state.stillness.reset();
  state.reference = null;
  state.needsReference = true;
  state.phase = 'watch';
  delete lens.dataset.calibrating;
  show('btn-start', false);
  show('btn-rotate', false);
  show('btn-recalibrate', true);
  const demo = state.source?.kind === 'demo';
  show('btn-play', demo);
  show('btn-step', demo);
  setHint(
    demo
      ? 'Press <b>Play demo game</b> to watch the Opera Game, or <b>Next move</b> to go one move at a time.'
      : 'Make sure the real board matches the digital one, then play. Move one piece at a time and take your hand away after each move.',
  );
  setStatus('Watching the board', 'live');
}

function canvasPoint(e: PointerEvent): Pt {
  const r = overlay.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * overlay.width,
    y: ((e.clientY - r.top) / r.height) * overlay.height,
  };
}

overlay.addEventListener('pointerdown', (e) => {
  if (state.phase !== 'calibrate') return;
  const p = canvasPoint(e);
  if (state.corners.length < 4) {
    state.corners.push(p);
    updateCalibrationUi();
    return;
  }
  let best = -1;
  let bestDist = 36;
  state.corners.forEach((c, i) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  state.dragging = best;
  if (best >= 0) overlay.setPointerCapture(e.pointerId);
});

overlay.addEventListener('pointermove', (e) => {
  if (state.dragging < 0) return;
  state.corners[state.dragging] = canvasPoint(e);
  updateCalibrationUi();
});

overlay.addEventListener('pointerup', () => (state.dragging = -1));

// ---------- Vision loop ----------

function processFrame(now: number): void {
  const image = frameCtx.getImageData(0, 0, frame.width, frame.height);
  const sig = state.sampler!.sample(image);
  const s = state.stillness.update(sig, now);
  if (!s.still) {
    if (s.busy) setStatus('Hand over the board…', 'busy');
    return;
  }
  if (!state.reference || state.needsReference) {
    state.reference = sig;
    state.needsReference = false;
    setStatus('Watching the board', 'live');
    return;
  }
  const changes = squareChanges(state.reference, sig);
  const match = matchMove(changes, state.chess.moves({ verbose: true }));
  if (match) {
    state.reference = sig;
    state.unreadable = { since: 0, squares: [] };
    playMove(match.move.from, match.move.to, match.move.promotion, 'camera');
    return;
  }
  const changed = changedSquares(changes);
  if (changed.length === 0) {
    // Nothing moved: follow slow lighting changes.
    state.reference = sig;
    state.unreadable = { since: 0, squares: [] };
    setStatus('Watching the board', 'live');
    return;
  }
  if (!state.unreadable.since) state.unreadable.since = now;
  state.unreadable.squares = changed.slice(0, 4);
  if (now - state.unreadable.since > 1400) {
    setStatus(`Can't read that move (${state.unreadable.squares.join(', ')} changed). Fix the board or tap the move`, 'warn');
  }
}

function drawOverlay(now: number): void {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (state.phase === 'calibrate') {
    if (state.h) drawGrid(overlayCtx, state.h, true);
    drawCorners(overlayCtx, state.corners, state.corners.length < 4 ? -1 : state.dragging);
    return;
  }
  if (state.phase !== 'watch' || !state.h) return;
  drawGrid(overlayCtx, state.h, false);
  if (state.flash && now < state.flash.until) {
    const alpha = Math.min(1, (state.flash.until - now) / 600) * 0.45;
    for (const sq of state.flash.squares) fillSquare(overlayCtx, state.h, sq, `rgba(227, 180, 90, ${alpha})`);
  }
  if (state.unreadable.since && now - state.unreadable.since > 1400) {
    for (const sq of state.unreadable.squares) fillSquare(overlayCtx, state.h, sq, 'rgba(239, 93, 93, 0.35)');
  }
  const best = currentBest();
  if (best && (state.coach === 'best' || state.revealed)) {
    const { from, to } = uciParts(best);
    drawArrow(overlayCtx, state.h, from, to, 'rgba(79, 194, 127, 0.85)');
  }
}

function loop(now: number): void {
  requestAnimationFrame(loop);
  const src = state.source;
  if (!src) return;
  if (src.kind === 'demo') {
    src.demo.render(now);
    frameCtx.drawImage(src.demo.canvas, 0, 0);
    const label = src.demo.playing ? 'Pause demo' : 'Play demo game';
    if ($('btn-play').textContent !== label) $('btn-play').textContent = label;
  } else if (video.readyState >= 2) {
    frameCtx.drawImage(video, 0, 0, frame.width, frame.height);
  }
  if (state.phase === 'watch' && now - state.lastProcess > PROCESS_EVERY_MS) {
    state.lastProcess = now;
    processFrame(now);
  }
  drawOverlay(now);
}

// ---------- Game ----------

function playMove(from: Square, to: Square, promotion: PieceSymbol | undefined, via: 'camera' | 'board'): void {
  const before = state.chess.fen();
  let move: Move;
  try {
    move = state.chess.move({ from, to, promotion: promotion ?? 'q' });
  } catch {
    return;
  }
  state.graded.push(null);
  state.pendingGrade = { index: state.graded.length - 1, before, after: state.chess.fen(), move };
  state.revealed = false;
  state.flash = { squares: [move.from, move.to], until: performance.now() + 1400 };
  if (via === 'board') state.needsReference = true;
  if (via === 'camera') setStatus(`Saw ${move.san}`, 'live');
  hideAlert();
  onPositionChanged();
}

function newGame(fen?: string): void {
  state.chess = new Chess(fen);
  state.startFen = state.chess.fen();
  state.graded = [];
  state.pendingGrade = null;
  state.evals.clear();
  state.analysis = null;
  state.needsReference = true;
  state.revealed = false;
  hideAlert();
  onPositionChanged();
}

function onPositionChanged(): void {
  const chess = state.chess;
  state.analysis = state.evals.get(chess.fen()) ?? null;
  if (chess.isGameOver()) {
    engine.stop();
    const score = chess.isCheckmate() ? (chess.turn() === 'w' ? -100000 : 100000) : 0;
    const final: Analysis = { fen: chess.fen(), depth: 0, score, mate: chess.isCheckmate() ? 0 : null, pv: [], best: null, done: true };
    state.evals.set(final.fen, final);
    state.analysis = final;
    tryGrade(final);
    showGameOver();
  } else {
    engine.analyse(chess.fen(), ANALYSIS_DEPTH, onAnalysis);
  }
  renderAll();
}

function onAnalysis(a: Analysis): void {
  const known = state.evals.get(a.fen);
  if (!known || a.depth >= known.depth || a.done) state.evals.set(a.fen, a);
  if (a.fen !== state.chess.fen()) return;
  state.analysis = a;
  tryGrade(a);
  renderCoach();
  renderBoard();
}

function tryGrade(a: Analysis): void {
  const p = state.pendingGrade;
  if (!p || a.fen !== p.after || (a.depth < GRADE_DEPTH && !a.done)) return;
  state.pendingGrade = null;
  const before = state.evals.get(p.before);
  if (!before) return;
  const g = gradeMove(p.move.color, before.score, a.score, moveToUci(p.move), before.best ?? before.pv[0] ?? null);
  state.graded[p.index] = g;
  renderMoves();
  if (g.grade === 'blunder' || g.grade === 'mistake') warnAbout(p.move, g, p.before, before);
}

function currentBest(): string | null {
  const a = state.analysis;
  if (!a || a.fen !== state.chess.fen()) return null;
  return a.best ?? a.pv[0] ?? null;
}

function uciToSan(fen: string, ucis: string[], limit: number): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of ucis.slice(0, limit)) {
    try {
      out.push(c.move(uciParts(u)).san);
    } catch {
      break;
    }
  }
  return out;
}

// ---------- Alerts ----------

function hideAlert(): void {
  show('alert', false);
}

function beep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {
    // Sound is optional.
  }
}

function warnAbout(move: Move, g: GradedMove, beforeFen: string, before: Analysis): void {
  const bestUci = before.best ?? before.pv[0];
  const better = bestUci ? uciToSan(beforeFen, [bestUci], 1)[0] : null;
  const drop = Math.round(g.loss * 100);
  const el = $('alert');
  el.dataset.grade = g.grade;
  el.innerHTML =
    `<strong>${GRADE_LABEL[g.grade]}: ${move.san}</strong>` +
    `That move cost about ${drop}% of ${move.color === 'w' ? "White's" : "Black's"} winning chances.` +
    (better ? ` Better was <b>${better}</b>.` : '');
  show('alert', true);
  if (g.grade === 'blunder') {
    beep();
    navigator.vibrate?.(180);
  }
}

function showGameOver(): void {
  const c = state.chess;
  let text = 'Draw.';
  if (c.isCheckmate()) text = `Checkmate. ${c.turn() === 'w' ? 'Black' : 'White'} wins.`;
  else if (c.isStalemate()) text = 'Stalemate. The game is a draw.';
  const w = averageAccuracy(state.graded, 'w');
  const b = averageAccuracy(state.graded, 'b');
  const el = $('alert');
  el.dataset.grade = 'end';
  el.innerHTML =
    `<strong>${text}</strong>` +
    (w !== null || b !== null
      ? `Accuracy: White ${w === null ? '–' : Math.round(w) + '%'}, Black ${b === null ? '–' : Math.round(b) + '%'}.`
      : '');
  show('alert', true);
}

// ---------- Rendering ----------

function renderAll(): void {
  renderBoard();
  renderCoach();
  renderMoves();
  const fen = state.chess.fen();
  $<HTMLAnchorElement>('btn-lichess').href = `https://lichess.org/analysis/standard/${fen.replace(/ /g, '_')}`;
}

function renderBoard(): void {
  const history = state.chess.history({ verbose: true });
  const last = history[history.length - 1] ?? null;
  const arrows: BoardArrow[] = [];
  const best = currentBest();
  if (best && (state.coach === 'best' || state.revealed)) {
    const { from, to } = uciParts(best);
    arrows.push({ from, to, kind: 'best' });
  }
  boardView.render(state.chess, last, arrows);
}

function describe(a: Analysis): string {
  if (a.mate !== null) {
    if (a.mate === 0) return 'Checkmate';
    return `${a.mate > 0 ? 'White' : 'Black'} mates in ${Math.abs(a.mate)}`;
  }
  const s = Math.abs(a.score);
  const side = a.score > 0 ? 'White' : 'Black';
  if (s < 35) return 'Equal position';
  if (s < 110) return `${side} is slightly better`;
  if (s < 300) return `${side} is better`;
  return `${side} is winning`;
}

function renderCoach(): void {
  const a = state.analysis;
  const chess = state.chess;
  const fill = $('evalbar-fill');
  const chance = a ? whiteWinChance(a.score) : 0.5;
  fill.style.height = `${(boardView.flipped ? 1 - chance : chance) * 100}%`;
  fill.style.background = boardView.flipped ? 'linear-gradient(180deg, #3a3530, #24201c)' : '';
  $('evalbar').style.background = boardView.flipped ? '#f1ebe0' : '';

  $('score').textContent = a ? formatScore(a) : '0.0';
  $('score-text').textContent = a ? describe(a) : 'Equal position';
  $('depth').textContent = a && a.depth ? `depth ${a.depth}` : '';

  const line = $('coach-line');
  const reveal = $('btn-reveal');
  reveal.hidden = true;
  if (chess.isGameOver()) {
    line.textContent = 'Game over. Press New game to play again.';
    return;
  }
  const side = chess.turn() === 'w' ? 'White' : 'Black';
  const best = currentBest();
  if (state.coach === 'off') {
    line.textContent = 'The coach is resting. Switch on Best move or Hint when you want help.';
  } else if (!best) {
    line.textContent = `Thinking about ${side}'s move…`;
  } else if (state.coach === 'best' || state.revealed) {
    const sans = uciToSan(chess.fen(), a!.pv.length ? a!.pv : [best], 5);
    line.innerHTML =
      `Best for ${side}: <b>${sans[0] ?? best}</b>` +
      (sans.length > 1 ? ` <span class="pv">then ${sans.slice(1).join(' ')}</span>` : '');
  } else {
    line.textContent = hintFor(chess, best);
    reveal.hidden = false;
  }
}

function renderMoves(): void {
  const list = $('movelist');
  const history = state.chess.history({ verbose: true });
  const [, turn, , , , num] = state.startFen.split(' ');
  let moveNo = Number(num) || 1;
  const frag = document.createDocumentFragment();
  if (turn === 'b' && history.length > 0) {
    frag.append(cell('num', `${moveNo}.`), cell('mv', '…'));
  }
  history.forEach((m, idx) => {
    if (m.color === 'w') frag.append(cell('num', `${moveNo}.`));
    const c = cell('mv', m.san);
    if (idx === history.length - 1) c.classList.add('is-current');
    const g = state.graded[idx];
    if (g) {
      const badge = document.createElement('i');
      badge.className = 'badge';
      badge.dataset.grade = g.grade;
      badge.title = GRADE_LABEL[g.grade];
      c.append(badge);
    }
    frag.append(c);
    if (m.color === 'b') moveNo++;
  });
  list.replaceChildren(frag);
  list.scrollTop = list.scrollHeight;

  const w = averageAccuracy(state.graded, 'w');
  const b = averageAccuracy(state.graded, 'b');
  show('acc', w !== null || b !== null);
  $('acc-w').textContent = w === null ? '–' : `${Math.round(w)}%`;
  $('acc-b').textContent = b === null ? '–' : `${Math.round(b)}%`;
}

function cell(cls: string, text: string): HTMLElement {
  const li = document.createElement('li');
  li.className = cls;
  li.textContent = text;
  return li;
}

// ---------- Controls ----------

$('btn-demo').addEventListener('click', () => void startDemo());
$('btn-camera').addEventListener('click', () => void startCamera());
$('btn-close').addEventListener('click', closeLens);
$('btn-start').addEventListener('click', startWatching);
$('btn-recalibrate').addEventListener('click', () => {
  if (state.source?.kind === 'demo') state.source.demo.playing = false;
  enterCalibration();
});
$('btn-rotate').addEventListener('click', () => {
  const [a, b, c, d] = state.corners;
  state.corners = [b, c, d, a];
  updateCalibrationUi();
});

$('btn-play').addEventListener('click', () => {
  const src = state.source;
  if (src?.kind !== 'demo') return;
  const { played, total } = src.demo.progress;
  if (played >= total) {
    src.demo.reset();
    newGame();
  }
  src.demo.playing = !src.demo.playing;
});
$('btn-step').addEventListener('click', () => {
  const src = state.source;
  if (src?.kind === 'demo') src.demo.step(performance.now());
});

$('coach-mode').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
  if (!btn) return;
  state.coach = btn.dataset.mode as CoachMode;
  state.revealed = false;
  for (const b of $('coach-mode').querySelectorAll('button')) {
    b.setAttribute('aria-checked', String(b === btn));
  }
  renderCoach();
  renderBoard();
});
$('btn-reveal').addEventListener('click', () => {
  state.revealed = true;
  renderCoach();
  renderBoard();
});

$('btn-undo').addEventListener('click', () => {
  if (!state.chess.undo()) return;
  state.graded.pop();
  state.pendingGrade = null;
  state.needsReference = true;
  hideAlert();
  onPositionChanged();
});
$('btn-flip').addEventListener('click', () => {
  boardView.flipped = !boardView.flipped;
  renderBoard();
  renderCoach();
});
$('btn-new').addEventListener('click', () => {
  const src = state.source;
  if (src?.kind === 'demo') {
    src.demo.reset();
    src.demo.playing = false;
  }
  newGame();
});
$('btn-fen').addEventListener('click', () => {
  const form = $('fen-form');
  form.hidden = !form.hidden;
  if (!form.hidden) {
    $<HTMLInputElement>('fen-input').value = state.chess.fen();
    $<HTMLInputElement>('fen-input').focus();
  }
});
$('fen-input').addEventListener('input', () => show('fen-error', false));
$('fen-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fen = $<HTMLInputElement>('fen-input').value.trim();
  const check = validateFen(fen);
  if (!check.ok) {
    $('fen-error').textContent = `That FEN isn't valid: ${check.error ?? 'check it and try again'}.`;
    show('fen-error', true);
    return;
  }
  newGame(fen);
  show('fen-form', false);
});
$('btn-pgn').addEventListener('click', () => {
  const c = state.chess;
  c.setHeader('Event', 'Grandmaster Lens game');
  c.setHeader('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
  if (state.startFen !== new Chess().fen()) {
    c.setHeader('SetUp', '1');
    c.setHeader('FEN', state.startFen);
  }
  const blob = new Blob([c.pgn() + '\n'], { type: 'application/x-chess-pgn' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grandmaster-lens-game.pgn';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

onPositionChanged();
requestAnimationFrame(loop);
