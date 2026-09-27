/**
 * Section 3.1.4 — Reversi (Othello) engine.
 *
 * The only game of the six that can leave a player with no legal move. That
 * case is reported through `nextTurnHasValidMoves` rather than resolved here:
 * the turn hand-off is session policy, and it is recorded in the move's
 * payload so a reconnecting client replays it correctly.
 */

import type { Coordinates, PlayerColor, ReversiBoard } from "../types";
import { opponentOf } from "../types";

export const REVERSI_SIZE = 8;

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export interface ReversiMoveResult {
  nextBoard: ReversiBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
  /** `false` when the opponent has no legal reply and the mover plays again. */
  nextTurnHasValidMoves: boolean;
}

export function createInitialReversiBoard(): ReversiBoard {
  const board: ReversiBoard = Array.from({ length: REVERSI_SIZE }, () =>
    Array<ReversiBoard[number][number]>(REVERSI_SIZE).fill(null)
  );
  board[3][3] = "white";
  board[3][4] = "black";
  board[4][3] = "black";
  board[4][4] = "white";
  return board;
}

function isOnBoard(x: number, y: number): boolean {
  return x >= 0 && x < REVERSI_SIZE && y >= 0 && y < REVERSI_SIZE;
}

/**
 * Opposing discs that `player` would flip by playing at `coord`.
 *
 * An empty result means the move is illegal: either the square is occupied, or
 * no ray of opponent discs is terminated by one of the mover's own stones.
 */
export function getFlipsForMove(
  board: ReversiBoard,
  coord: Coordinates,
  player: PlayerColor
): Coordinates[] {
  if (!isOnBoard(coord.x, coord.y)) return [];
  if (board[coord.y][coord.x] !== null) return [];

  const opponent = opponentOf(player);
  const flips: Coordinates[] = [];

  for (const [dy, dx] of DIRECTIONS) {
    const candidateFlips: Coordinates[] = [];
    let curY = coord.y + dy;
    let curX = coord.x + dx;

    while (isOnBoard(curX, curY)) {
      const cell = board[curY][curX];
      if (cell === opponent) {
        candidateFlips.push({ x: curX, y: curY });
        curY += dy;
        curX += dx;
      } else if (cell === player) {
        if (candidateFlips.length > 0) flips.push(...candidateFlips);
        break;
      } else {
        break;
      }
    }
  }

  return flips;
}

export function getValidReversiMoves(board: ReversiBoard, player: PlayerColor): Coordinates[] {
  const validMoves: Coordinates[] = [];
  for (let y = 0; y < REVERSI_SIZE; y += 1) {
    for (let x = 0; x < REVERSI_SIZE; x += 1) {
      if (getFlipsForMove(board, { x, y }, player).length > 0) {
        validMoves.push({ x, y });
      }
    }
  }
  return validMoves;
}

export function countReversiDiscs(board: ReversiBoard): Record<PlayerColor, number> {
  let black = 0;
  let white = 0;
  for (let y = 0; y < REVERSI_SIZE; y += 1) {
    for (let x = 0; x < REVERSI_SIZE; x += 1) {
      const cell = board[y][x];
      if (cell === "black") black += 1;
      else if (cell === "white") white += 1;
    }
  }
  return { black, white };
}

export function applyReversiMove(
  board: ReversiBoard,
  coord: Coordinates,
  player: PlayerColor
): ReversiMoveResult {
  const flips = getFlipsForMove(board, coord, player);
  if (flips.length === 0) {
    throw new Error("Invalid move: no pieces flipped");
  }

  const nextBoard = board.map((row) => [...row]);
  nextBoard[coord.y][coord.x] = player;
  for (const flipped of flips) {
    nextBoard[flipped.y][flipped.x] = player;
  }

  const opponent = opponentOf(player);
  const opponentMoves = getValidReversiMoves(nextBoard, opponent);
  const playerMoves = getValidReversiMoves(nextBoard, player);

  let winner: PlayerColor | null = null;
  let isDraw = false;

  if (opponentMoves.length === 0 && playerMoves.length === 0) {
    const counts = countReversiDiscs(nextBoard);
    if (counts.black > counts.white) winner = "black";
    else if (counts.white > counts.black) winner = "white";
    else isDraw = true;
  }

  return {
    nextBoard,
    winner,
    isDraw,
    nextTurnHasValidMoves: opponentMoves.length > 0,
  };
}
