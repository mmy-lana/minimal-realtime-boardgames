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
/**
 * How many stones of a winning run are reported. Five is the rule; a run of
 * nine is the same fact told at greater length, and on a 15x15 board a
 * fifteen-stone highlight reads as a stripe across the wood rather than as the
 * line that won. The window is centred on the stone just played, so the stone
 * the player is looking at is always inside it.
 */
export const GOMOKU_HIGHLIGHT_LENGTH = 5;

export interface GomokuMoveResult {
  nextBoard: GomokuBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
  /**
   * The stones that made the winning run, ordered along its axis, or `null`
   * while nobody has won. Long runs are trimmed to a window centred on the
   * stone just played — see {@link GOMOKU_HIGHLIGHT_LENGTH} — because
   * highlighting fifteen intersections says "this stone won" less clearly than
   * highlighting five.
   */
  winningLine: Coordinates[] | null;
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
      const back: Coordinates[] = [];
      const forward: Coordinates[] = [];

      for (let step = 1; step < GOMOKU_SIZE; step += 1) {
        const ny = coord.y + dy * step;
        const nx = coord.x + dx * step;
        if (ny < 0 || ny >= GOMOKU_SIZE || nx < 0 || nx >= GOMOKU_SIZE) break;
        if (nextBoard[ny][nx] !== player) break;
        forward.push({ x: nx, y: ny });
      }

      for (let step = 1; step < GOMOKU_SIZE; step += 1) {
        const ny = coord.y - dy * step;
        const nx = coord.x - dx * step;
        if (ny < 0 || ny >= GOMOKU_SIZE || nx < 0 || nx >= GOMOKU_SIZE) break;
        if (nextBoard[ny][nx] !== player) break;
        back.push({ x: nx, y: ny });
      }

      // Along the axis, and trimmed to a five-stone window that stays as centred
      // on the stone just played as the run allows. A run of exactly five is
      // reported whole; a run of nine keeps five of the nine, and the stone under
      // the player's finger is always one of them.
      //
      // The window is clamped rather than sliced at a fixed offset on each side.
      // Slicing `2` off the back and `2` off the front quietly returns *three*
      // stones whenever the player completes the run from one end of it, which
      // is exactly the case a player watches. The clamp takes what is there.
      const along: Coordinates[] = [...back.reverse(), coord, ...forward];
      const lead = Math.floor((GOMOKU_HIGHLIGHT_LENGTH - 1) / 2);
      const start = Math.min(
        Math.max(back.length - lead, 0),
        along.length - GOMOKU_HIGHLIGHT_LENGTH
      );
      const winningLine = along.slice(start, start + GOMOKU_HIGHLIGHT_LENGTH);

      return { nextBoard, winner: player, isDraw: false, winningLine };
    }
  }

  const isDraw = nextBoard.every((row) => row.every((cell) => cell !== null));
  return { nextBoard, winner: null, isDraw, winningLine: null };
}
