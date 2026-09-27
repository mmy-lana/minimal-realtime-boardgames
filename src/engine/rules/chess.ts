/**
 * Section 3.1.6 — Chess engine (deterministic micro-engine).
 *
 * Implemented rule set (the plan's deliberate scope for a self-contained
 * engine): standard piece movement, pawn promotion is not modelled, and a game
 * ends when the king is captured. Castling, en passant, check detection and
 * fifty-move/stalemate draws are out of scope, so the engine stays pure and
 * every move is reproducible from coordinates alone.
 *
 * `getBoardCell` is re-exported from `../types` so callers have a single
 * import site for coordinate access.
 */

import type { ChessBoard, ChessCell, ChessPieceType, Coordinates, PlayerColor } from "../types";
import { getBoardCell, setBoardCell } from "../types";

export { getBoardCell };

export const CHESS_SIZE = 8;

export interface ChessMoveResult {
  nextBoard: ChessBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
}

export function createInitialChessBoard(): ChessBoard {
  const layoutOrder: ChessPieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  const board: ChessBoard = Array.from({ length: CHESS_SIZE }, () =>
    Array<ChessCell>(CHESS_SIZE).fill(null)
  );

  for (let c = 0; c < CHESS_SIZE; c += 1) {
    board[0][c] = { color: "black", type: layoutOrder[c], hasMoved: false };
    board[1][c] = { color: "black", type: "p", hasMoved: false };
    board[6][c] = { color: "white", type: "p", hasMoved: false };
    board[7][c] = { color: "white", type: layoutOrder[c], hasMoved: false };
  }
  return board;
}

export function getChessRawMoves(
  board: ChessBoard,
  from: Coordinates,
  player: PlayerColor
): Coordinates[] {
  const piece = getBoardCell(board, from.x, from.y);
  if (!piece || piece.color !== player) return [];

  const targets: Coordinates[] = [];

  /**
   * Records a reachable square and reports whether the ray may continue past
   * it. Sliding pieces stop on the first piece they meet; a square occupied by
   * an enemy is capturable but not traversable.
   */
  const pushIfValid = (y: number, x: number): boolean => {
    if (y < 0 || y >= CHESS_SIZE || x < 0 || x >= CHESS_SIZE) return false;
    const dest = getBoardCell(board, x, y);
    if (dest === null) {
      targets.push({ x, y });
      return true;
    }
    if (dest.color !== player) {
      targets.push({ x, y });
    }
    return false;
  };

  switch (piece.type) {
    case "p": {
      const fwd = player === "black" ? 1 : -1;
      const startRank = player === "black" ? 1 : 6;
      const oneStepY = from.y + fwd;
      const twoStepY = from.y + 2 * fwd;

      if (getBoardCell(board, from.x, oneStepY) === null) {
        targets.push({ x: from.x, y: oneStepY });
        if (from.y === startRank && getBoardCell(board, from.x, twoStepY) === null) {
          targets.push({ x: from.x, y: twoStepY });
        }
      }
      for (const diagX of [from.x - 1, from.x + 1]) {
        if (diagX >= 0 && diagX < CHESS_SIZE) {
          const dest = getBoardCell(board, diagX, oneStepY);
          if (dest && dest.color !== player) {
            targets.push({ x: diagX, y: oneStepY });
          }
        }
      }
      break;
    }
    case "n": {
      const knightOffsets: readonly (readonly [number, number])[] = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ];
      for (const [dy, dx] of knightOffsets) {
        pushIfValid(from.y + dy, from.x + dx);
      }
      break;
    }
    case "b":
    case "r":
    case "q": {
      const dirs: [number, number][] = [];
      if (piece.type === "r" || piece.type === "q") {
        dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      }
      if (piece.type === "b" || piece.type === "q") {
        dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      }
      for (const [dy, dx] of dirs) {
        let step = 1;
        // `pushIfValid` returning false means the ray is blocked, which also
        // covers the "stop after capturing" case, so no second test is needed.
        while (pushIfValid(from.y + dy * step, from.x + dx * step)) {
          step += 1;
        }
      }
      break;
    }
    case "k": {
      const kingDirs: readonly (readonly [number, number])[] = [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ];
      for (const [dy, dx] of kingDirs) {
        pushIfValid(from.y + dy, from.x + dx);
      }
      break;
    }
  }

  return targets;
}

/** Every square from which the player may currently move. */
export function getChessSelectableSquares(
  board: ChessBoard,
  player: PlayerColor
): Coordinates[] {
  const squares: Coordinates[] = [];
  for (let y = 0; y < CHESS_SIZE; y += 1) {
    for (let x = 0; x < CHESS_SIZE; x += 1) {
      const piece = getBoardCell(board, x, y);
      if (!piece || piece.color !== player) continue;
      if (getChessRawMoves(board, { x, y }, player).length > 0) squares.push({ x, y });
    }
  }
  return squares;
}

export function applyChessMove(
  board: ChessBoard,
  from: Coordinates,
  to: Coordinates,
  player: PlayerColor
): ChessMoveResult {
  const rawMoves = getChessRawMoves(board, from, player);
  const isValid = rawMoves.some((move) => move.x === to.x && move.y === to.y);

  if (!isValid) {
    throw new Error("Invalid chess move requested");
  }

  const activePiece = getBoardCell(board, from.x, from.y);
  if (!activePiece) throw new Error("Invalid chess move: no piece on the origin square");

  const targetSquare = getBoardCell(board, to.x, to.y);

  let winner: PlayerColor | null = null;
  if (targetSquare && targetSquare.type === "k") {
    winner = player;
  }

  const nextBoard = board.map((row) => [...row]);
  setBoardCell(nextBoard, from.x, from.y, null);
  setBoardCell(nextBoard, to.x, to.y, { ...activePiece, hasMoved: true });

  return { nextBoard, winner, isDraw: false };
}
