# ♞ Grandmaster Lens – your real chessboard, with a grandmaster watching

**🌐 Live demo: https://hanee2907.github.io/grandmaster-lens/**

Point your phone or laptop camera at a real, wooden chessboard. Grandmaster Lens follows the game
move by move, rebuilds the position on a digital board, and coaches you live with Stockfish,
drawing the best move as an arrow **right on top of the real pieces**.

No board nearby? Press **Try the demo board**: a simulated camera shows a board on a table and a
hand plays Morphy's famous *Opera Game* (1858), so you can watch the whole pipeline work.

![Grandmaster Lens](./docs/screenshot.png)

## ✨ Features

- **Camera calibration:** tap the board's four corners once; drag the handles to fine-tune, or rotate the labels if you started from the wrong corner
- **Move detection from video:** the app waits for your hand to leave the board, works out which squares changed, and matches them to the one legal move that explains them (including castling, en passant and promotion)
- **Live analysis:** Stockfish runs in your browser through WebAssembly, with an evaluation bar, score and best line
- **Arrows on the real board:** the best move is drawn in perspective, so it lies flat on the camera image
- **Coach modes:** *Best move*, *Hint* (points at the right piece without giving the move away) or *Off*
- **Blunder alerts:** every move is graded Best, Good, Inaccuracy, Mistake or Blunder; mistakes show what was better, and blunders beep and buzz
- **Accuracy score** for both players, Lichess-style
- **Digital twin:** click moves on the digital board to play or correct a move, undo, flip, load any position from FEN
- **Export:** download the game as PGN or open the position in Lichess

## 🧠 How it works

| Step | How |
|---|---|
| Board geometry | From the four tapped corners, a **homography** (3×3 perspective transform, solved with Gaussian elimination) maps the flat 8×8 board onto the tilted board the camera sees |
| Square signatures | Each square is sampled on a 7×7 grid of points away from its edges, giving a colour signature per square |
| Waiting for the hand | Signatures are compared frame to frame; the view counts as *still* once nothing has changed for 650 ms |
| Lighting | The median change across all 64 squares is subtracted, so a cloud or lamp doesn't look like a move |
| Reading the move | Instead of recognising every piece, the app uses the known position: a move only changes 2 squares (3 for en passant, 4 for castling), so every legal move is scored by how well its squares match the changes |
| Engine | Stockfish runs in a Web Worker over the UCI protocol; scores are converted to White's point of view |
| Move grades | Based on the drop in *winning chances* (the same curve Lichess uses), so losing a pawn in a won position counts less than in an equal one |
| Demo camera | A top-down board texture is projected into an angled view pixel by pixel with the inverse homography, then an arm is drawn reaching in to move each piece |

## 🛠️ Built with

- TypeScript (strict mode) and Vite
- Canvas 2D, MediaDevices (camera), Web Workers, Web Audio
- [chess.js](https://github.com/jhlywa/chess.js) for the rules
- [Stockfish](https://stockfishchess.org) compiled to WebAssembly ([stockfish.js](https://github.com/nmrugg/stockfish.js))
- Vitest for unit tests (geometry, move matching, grading)
- CSS3 (glass cards, sticky layout, responsive grid, reduced-motion support)

## 🚀 Run it locally

```bash
npm install
npm run dev
```

Run the tests with `npm test`, build with `npm run build`, and publish to GitHub Pages with `npm run deploy`.
The camera needs `localhost` or HTTPS.

## 📁 Project structure

```
src/
├── main.ts          # Connects camera, calibration, vision, engine and UI
├── geometry.ts      # Homography, inverse and board coordinates
├── vision.ts        # Square signatures and the "is the hand gone?" detector
├── tracker.ts       # Matches changed squares to a legal move
├── engine.ts        # Stockfish over UCI in a Web Worker
├── coach.ts         # Move grades, accuracy and hints
├── simulator.ts     # The demo camera with a hand that plays moves
├── pieces.ts        # Piece artwork
├── ui/board.ts      # Digital board with click-to-move and arrows
└── ui/overlay.ts    # Grid, handles and arrows drawn on the camera view
```

## 🗺️ Ideas for next

- Find the board corners automatically
- Recognise pieces with a small trained model, to start from any position without typing a FEN
- Play against Stockfish over the real board, with the engine's moves shown as arrows

## 📜 Credits and license

- Engine: Stockfish, GPLv3 (see `public/engine/COPYING-stockfish.txt`)
- Pieces: *cburnett* set by Colin M.L. Burnett, CC BY-SA 3.0
- This project is released under the GPLv3 license.
