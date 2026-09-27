/**
 * Section 3.1.1 — Tic-Tac-Toe engine.
 *
 * Pure functions over a flat 9-cell board. No I/O, no framework imports: the
 * same code runs in a React render pass, in the sync layer and in the
 * reconnect replay.
 */

import type { Coordinates, PlayerColor, TicTacToeBoard } from "../types";

export const TICTACTOE_SIZE = 3;
export const TICTACTOE_CELLS = TICTACTOE_SIZE * TICTACTOE_SIZE;

/** Row-major winning lines, shared by the engine and the board view's rules. */
export const TICTACTOE_WINNING_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export interface TicTacToeMoveResult {
  nextBoard: TicTacToeBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
}

export function createInitialTicTacToeBoard(): TicTacToeBoard {
  return Array<TicTacToeBoard[number]>(TICTACTOE_CELLS).fill(null);
}

export function validateTicTacToeMove(board: TicTacToeBoard, index: number): boolean {
  return index >= 0 && index < TICTACTOE_CELLS && board[index] === null;
}

/** Converts a board coordinate into the flat row-major index the engine uses. */
export function tictactoeIndexOf(coord: Coordinates): number {
  return coord.y * TICTACTOE_SIZE + coord.x;
}

/** Inverse of {@link tictactoeIndexOf}. */
export function tictactoeCoordOf(index: number): Coordinates {
  return { x: index % TICTACTOE_SIZE, y: Math.floor(index / TICTACTOE_SIZE) };
}

/** Every empty cell, i.e. the full legal move set. */
export function getTicTacToeLegalMoves(board: TicTacToeBoard): Coordinates[] {
  const moves: Coordinates[] = [];
  for (let index = 0; index < TICTACTOE_CELLS; index += 1) {
    if (board[index] === null) moves.push(tictactoeCoordOf(index));
  }
  return moves;
}

/** The winning line containing the last stone, or `null` when there is none. */
export function findTicTacToeWinningLine(
  board: TicTacToeBoard,
  index: number
): readonly [number, number, number] | null {
  for (const line of TICTACTOE_WINNING_LINES) {
    if (!line.includes(index)) continue;
    const [a, b, c] = line;
    const cell = board[a];
    if (cell !== null && cell === board[b] && cell === board[c]) return line;
  }
  return null;
}

export function applyTicTacToeMove(
  board: TicTacToeBoard,
  index: number,
  player: PlayerColor
): TicTacToeMoveResult {
  if (!validateTicTacToeMove(board, index)) {
    throw new Error(`Invalid tic-tac-toe move: index ${index} is out of range or occupied`);
  }

  const nextBoard = [...board];
  nextBoard[index] = player;

  const winningLine = findTicTacToeWinningLine(nextBoard, index);
  if (winningLine) {
    return { nextBoard, winner: player, isDraw: false };
  }

  const isDraw = nextBoard.every((cell) => cell !== null);
  return { nextBoard, winner: null, isDraw };
}
