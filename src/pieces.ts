// Piece artwork: the "cburnett" set by Colin M.L. Burnett (CC BY-SA 3.0).

import type { Color, PieceSymbol } from 'chess.js';

export function pieceUrl(color: Color, type: PieceSymbol): string {
  return `${import.meta.env.BASE_URL}pieces/${color}${type.toUpperCase()}.svg`;
}

/** Loads all twelve piece images, keyed like "wN" or "bP". */
export async function loadPieceImages(): Promise<Map<string, HTMLImageElement>> {
  const images = new Map<string, HTMLImageElement>();
  const jobs: Promise<void>[] = [];
  for (const color of ['w', 'b'] as Color[]) {
    for (const type of ['k', 'q', 'r', 'b', 'n', 'p'] as PieceSymbol[]) {
      const img = new Image();
      img.src = pieceUrl(color, type);
      images.set(color + type.toUpperCase(), img);
      jobs.push(img.decode());
    }
  }
  await Promise.all(jobs);
  return images;
}
