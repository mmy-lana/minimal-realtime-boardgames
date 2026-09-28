/**
 * Section 3.1.2 — Connect Four engine.
 *
 * A move is identified by its target column alone; gravity decides the row.
 * The row is returned alongside the new board so the board view can animate
 * the drop from the correct height without recomputing it.
 */

import type { Connect4Board, Coordinates, PlayerColor } from "../types";

export const CONNECT4_ROWS = 6;
export const CONNECT4_COLS = 7;
export const CONNECT4_WIN_LENGTH = 4;

export interface Connect4MoveResult {
  nextBoard: Connect4Board;
  placedRow: number;
  winner: PlayerColor | null;
  isDraw: boolean;
  /**
   * The discs that connected, ordered along the axis they run in, or `null`
   * while nobody has won. A run of five or six still ends a game here, and it
   * reports all of its discs rather than the four that first satisfied the
   * rule.
   */
  winningLine: Coordinates[] | null;
}

export function createInitialConnect4Board(): Connect4Board {
  return Array.from({ length: CONNECT4_ROWS }, () =>
    Array<Connect4Board[number][number]>(CONNECT4_COLS).fill(null)
  );
}

export function getConnect4LowestAvailableRow(board: Connect4Board, col: number): number {
  for (let row = CONNECT4_ROWS - 1; row >= 0; row -= 1) {
    if (board[row][col] === null) return row;
  }
  return -1;
}

/** Columns that still accept a disc, left to right. */
export function getConnect4LegalMoves(board: Connect4Board): Coordinates[] {
  const moves: Coordinates[] = [];
  for (let col = 0; col < CONNECT4_COLS; col += 1) {
    if (getConnect4LowestAvailableRow(board, col) !== -1) {
      // `y` is unused by this game: gravity derives the row. Recording the
      // resolved landing row keeps the move log readable and self-describing.
      moves.push({ x: col, y: getConnect4LowestAvailableRow(board, col) });
    }
  }
  return moves;
}

export function applyConnect4Move(
  board: Connect4Board,
  col: number,
  player: PlayerColor
): Connect4MoveResult {
  if (!Number.isInteger(col) || col < 0 || col >= CONNECT4_COLS) {
    throw new Error(`Invalid connect four move: column ${col} is out of range`);
  }

  const targetRow = getConnect4LowestAvailableRow(board, col);
  if (targetRow === -1) {
    throw new Error("Target column is fully occupied");
  }

  const nextBoard = board.map((row) => [...row]);
  nextBoard[targetRow][col] = player;

  const directions: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of directions) {
    // The run is *collected*, not just counted. The board is already being
    // walked in both directions, so the cells that decide the game are the ones
    // it passes over: counting first and re-walking afterwards to find them
    // would be two scans of the same cells, and the second one is where a
    // highlight ends up one cell short of the win.
    const back: Coordinates[] = [];
    const forward: Coordinates[] = [];

    for (let s = 1; s < CONNECT4_WIN_LENGTH; s += 1) {
      const nr = targetRow + dr * s;
      const nc = col + dc * s;
      if (
        nr >= 0 &&
        nr < CONNECT4_ROWS &&
        nc >= 0 &&
        nc < CONNECT4_COLS &&
        nextBoard[nr][nc] === player
      ) {
        forward.push({ x: nc, y: nr });
      } else {
        break;
      }
    }

    for (let s = 1; s < CONNECT4_WIN_LENGTH; s += 1) {
      const nr = targetRow - dr * s;
      const nc = col - dc * s;
      if (
        nr >= 0 &&
        nr < CONNECT4_ROWS &&
        nc >= 0 &&
        nc < CONNECT4_COLS &&
        nextBoard[nr][nc] === player
      ) {
        back.push({ x: nc, y: nr });
      } else {
        break;
      }
    }

    // 1 + the run either side. Both scans are capped at three cells, which is
    // the longest that can exist in either direction on this board, so a win
    // reported here is never a truncated one.
    if (1 + back.length + forward.length >= CONNECT4_WIN_LENGTH) {
      // Along the axis, not in the order the walk found them: a "line" a view
      // wants to draw through has to be a sequence of adjacent cells, and
      // `[move, forward…, back…]` is not one.
      //
      // Trimmed to exactly four, centred on the disc just played. Play can never
      // produce a longer run — the game stopped when the fourth connected — but a
      // replayed board could, and a view that rings five discs for a four-in-a-row
      // is reporting a fact the rules do not have. Centring on the played disc
      // keeps the stone the player is looking at inside the highlight.
      const along: Coordinates[] = [...back.reverse(), { x: col, y: targetRow }, ...forward];
      const played = back.length;
      const lead = Math.floor((CONNECT4_WIN_LENGTH - 1) / 2);
      const start = Math.min(Math.max(played - lead, 0), along.length - CONNECT4_WIN_LENGTH);
      const winningLine = along.slice(start, start + CONNECT4_WIN_LENGTH);
      return { nextBoard, placedRow: targetRow, winner: player, isDraw: false, winningLine };
    }
  }

  // Row 0 is the top of the board; once it is full, no disc can enter.
  const isDraw = nextBoard[0].every((cell) => cell !== null);
  return { nextBoard, placedRow: targetRow, winner: null, isDraw, winningLine: null };
}
