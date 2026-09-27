/**
 * Section 3.1.3 — Gomoku engine.
 *
 * Stones are placed on the 15x15 intersections. A run of five or more
 * consecutive stones in any of the four axes wins, regardless of whether the
 * run is centred on the newly placed stone.
 */

import type { Coordinates, GomokuBoard, PlayerColor } from "../types";

export const GOMOKU_SIZE = 15;
export const GOMOKU_WIN_LENGTH = 5;

export interface GomokuMoveResult {
  nextBoard: GomokuBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
}

export function createInitialGomokuBoard(): GomokuBoard {
  return Array.from({ length: GOMOKU_SIZE }, () =>
    Array<GomokuBoard[number][number]>(GOMOKU_SIZE).fill(null)
  );
}

export function validateGomokuMove(board: GomokuBoard, coord: Coordinates): boolean {
  if (!Number.isInteger(coord.x) || !Number.isInteger(coord.y)) return false;
  if (coord.x < 0 || coord.x >= GOMOKU_SIZE) return false;
  if (coord.y < 0 || coord.y >= GOMOKU_SIZE) return false;
  return board[coord.y][coord.x] === null;
}

/** Every empty intersection, row-major. */
export function getGomokuLegalMoves(board: GomokuBoard): Coordinates[] {
  const moves: Coordinates[] = [];
  for (let y = 0; y < GOMOKU_SIZE; y += 1) {
    for (let x = 0; x < GOMOKU_SIZE; x += 1) {
      if (board[y][x] === null) moves.push({ x, y });
    }
  }
  return moves;
}

/**
 * Counts the run of identical stones through `(coord.x, coord.y)` along one
 * axis. Shared by the engine and by the board view's winning-line highlight.
 */
export function countGomokuRun(
  board: GomokuBoard,
  coord: Coordinates,
  player: PlayerColor,
  dy: number,
  dx: number
): number {
  let streak = 1;
  for (let step = 1; step < GOMOKU_SIZE; step += 1) {
    const ny = coord.y + dy * step;
    const nx = coord.x + dx * step;
    if (ny < 0 || ny >= GOMOKU_SIZE || nx < 0 || nx >= GOMOKU_SIZE) break;
    if (board[ny][nx] !== player) break;
    streak += 1;
  }
  for (let step = 1; step < GOMOKU_SIZE; step += 1) {
    const ny = coord.y - dy * step;
    const nx = coord.x - dx * step;
    if (ny < 0 || ny >= GOMOKU_SIZE || nx < 0 || nx >= GOMOKU_SIZE) break;
    if (board[ny][nx] !== player) break;
    streak += 1;
  }
  return streak;
}

export function applyGomokuMove(
  board: GomokuBoard,
  coord: Coordinates,
  player: PlayerColor
): GomokuMoveResult {
  if (!validateGomokuMove(board, coord)) {
    throw new Error("Square is already occupied or outside the board");
  }

  const nextBoard = board.map((row) => [...row]);
  nextBoard[coord.y][coord.x] = player;

  const vectors: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dy, dx] of vectors) {
    if (countGomokuRun(nextBoard, coord, player, dy, dx) >= GOMOKU_WIN_LENGTH) {
      return { nextBoard, winner: player, isDraw: false };
    }
  }

  const isDraw = nextBoard.every((row) => row.every((cell) => cell !== null));
  return { nextBoard, winner: null, isDraw };
}
