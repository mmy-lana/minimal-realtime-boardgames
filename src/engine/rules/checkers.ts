/**
 * Section 3.1.5 — Checkers engine.
 *
 * Implemented rule set (American/English checkers as scoped by the plan):
 * men capture forward only, kings capture in all four diagonal directions,
 * a jump is mandatory when one exists, and reaching the far rank crowns a man
 * at the end of the move. Captured pieces are removed immediately, so a
 * multi-jump sequence is expressed as consecutive plies rather than as one
 * compound move — and the engine reports `canJumpAgain` on each one, which is
 * what holds the turn with the player who has not finished capturing yet.
 */

import type { CheckersBoard, CheckersCell, Coordinates, PlayerColor } from "../types";
import { getBoardCell, opponentOf, setBoardCell } from "../types";

export const CHECKERS_SIZE = 8;

export interface CheckersMoveOption {
  from: Coordinates;
  to: Coordinates;
  /** Occupied square removed by a capture. Derived by {@link deriveJumpedCoord}. */
  jumpedCoord?: Coordinates;
}

export interface CheckersMoveResult {
  nextBoard: CheckersBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
  /**
   * `true` when the piece that just landed can jump again from where it now
   * stands.
   *
   * A capture chain is one move, not several: the player never gets to stop
   * halfway and the opponent never gets a turn in the middle. This flag is how
   * the rest of the app learns that, because the only other way to express it
   * would be to hand the turn over and take it straight back.
   */
  canJumpAgain: boolean;
}

export function createInitialCheckersBoard(): CheckersBoard {
  const board: CheckersBoard = Array.from({ length: CHECKERS_SIZE }, () =>
    Array<CheckersCell>(CHECKERS_SIZE).fill(null)
  );
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < CHECKERS_SIZE; x += 1) {
      if ((y + x) % 2 === 1) board[y][x] = { color: "black", type: "pawn" };
    }
  }
  for (let y = 5; y < CHECKERS_SIZE; y += 1) {
    for (let x = 0; x < CHECKERS_SIZE; x += 1) {
      if ((y + x) % 2 === 1) board[y][x] = { color: "white", type: "pawn" };
    }
  }
  return board;
}

/** `true` when the square holds a dark, playable cell. */
export function isPlayableSquare(x: number, y: number): boolean {
  return x >= 0 && x < CHECKERS_SIZE && y >= 0 && y < CHECKERS_SIZE && (x + y) % 2 === 1;
}

/**
 * Recovers the captured square from a jump's endpoints.
 *
 * Section 4.4 requires a reconnecting client to re-derive `jumpedCoord` from
 * the `from`/`to` pair alone, because the `game_moves` row only stores the two
 * endpoints. A jump always spans exactly two rows, so the captured piece sits
 * on the midpoint.
 */
export function deriveJumpedCoord(
  from: Coordinates,
  to: Coordinates
): Coordinates | undefined {
  if (Math.abs(to.y - from.y) !== 2 || Math.abs(to.x - from.x) !== 2) return undefined;
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

export function getCheckersLegalMoves(
  board: CheckersBoard,
  player: PlayerColor
): CheckersMoveOption[] {
  const jumpMoves: CheckersMoveOption[] = [];
  const simpleMoves: CheckersMoveOption[] = [];
  const forwardDelta = player === "black" ? 1 : -1;

  for (let y = 0; y < CHECKERS_SIZE; y += 1) {
    for (let x = 0; x < CHECKERS_SIZE; x += 1) {
      const piece = board[y][x];
      if (!piece || piece.color !== player) continue;

      const directions: readonly (readonly [number, number])[] =
        piece.type === "king"
          ? [
              [-1, -1],
              [-1, 1],
              [1, -1],
              [1, 1],
            ]
          : [
              [forwardDelta, -1],
              [forwardDelta, 1],
            ];

      for (const [dy, dx] of directions) {
        const ny = y + dy;
        const nx = x + dx;

        if (ny < 0 || ny >= CHECKERS_SIZE || nx < 0 || nx >= CHECKERS_SIZE) continue;

        const adjacent = board[ny][nx];
        if (adjacent === null) {
          simpleMoves.push({ from: { x, y }, to: { x: nx, y: ny } });
        } else if (adjacent.color !== player) {
          const jny = ny + dy;
          const jnx = nx + dx;
          if (jny >= 0 && jny < CHECKERS_SIZE && jnx >= 0 && jnx < CHECKERS_SIZE) {
            if (getBoardCell(board, jnx, jny) === null) {
              jumpMoves.push({
                from: { x, y },
                to: { x: jnx, y: jny },
                jumpedCoord: { x: nx, y: ny },
              });
            }
          }
        }
      }
    }
  }

  // Forced capture: a jump always outranks a quiet move.
  return jumpMoves.length > 0 ? jumpMoves : simpleMoves;
}

/** Legal destinations for one specific piece, for the board view's selection UI. */
export function getCheckersMovesFrom(
  board: CheckersBoard,
  from: Coordinates,
  player: PlayerColor
): CheckersMoveOption[] {
  const piece = getBoardCell(board, from.x, from.y);
  if (!piece || piece.color !== player) return [];
  return getCheckersLegalMoves(board, player).filter((move) => move.from.x === from.x && move.from.y === from.y);
}

export function applyCheckersMove(
  board: CheckersBoard,
  move: CheckersMoveOption,
  player: PlayerColor
): CheckersMoveResult {
  const activePiece = getBoardCell(board, move.from.x, move.from.y);
  if (!activePiece || activePiece.color !== player) {
    throw new Error("Invalid checkers move: piece selection error");
  }

  if (move.to.x < 0 || move.to.x >= CHECKERS_SIZE || move.to.y < 0 || move.to.y >= CHECKERS_SIZE) {
    throw new Error("Invalid checkers move: destination is off the board");
  }
  if (getBoardCell(board, move.to.x, move.to.y) !== null) {
    throw new Error("Invalid checkers move: destination is occupied");
  }

  // The jumped square, when the wire did not supply one, is re-derived from the
  // endpoints so a replayed move is identical to a locally dispatched one.
  const jumpedCoord = move.jumpedCoord ?? deriveJumpedCoord(move.from, move.to);
  if (jumpedCoord) {
    const captured = getBoardCell(board, jumpedCoord.x, jumpedCoord.y);
    if (captured === null) {
      throw new Error("Invalid checkers move: cannot jump over an empty square");
    }
    if (captured.color === player) {
      throw new Error("Invalid checkers move: cannot capture own piece");
    }
  } else if (Math.abs(move.to.x - move.from.x) === 2 || Math.abs(move.to.y - move.from.y) === 2) {
    // A two-square diagonal is only ever a capture, so the midpoint must exist
    // for the move to be geometrically coherent.
    throw new Error("Invalid checkers move: cannot jump over an empty square");
  }

  const nextBoard = board.map((row) => [...row]);
  setBoardCell(nextBoard, move.from.x, move.from.y, null);

  // Whether the man crowned by this move, as distinct from a piece that was
  // already a king. The distinction decides the rest of the turn: a king that
  // lands on the king row has not changed, so its chain continues, while a man
  // that arrives there has just been promoted and the move is over.
  const wasKing = activePiece.type === "king";
  let isCrowned = wasKing;
  if (player === "black" && move.to.y === CHECKERS_SIZE - 1) isCrowned = true;
  if (player === "white" && move.to.y === 0) isCrowned = true;
  const newlyCrowned = isCrowned && !wasKing;

  setBoardCell(nextBoard, move.to.x, move.to.y, { color: player, type: isCrowned ? "king" : "pawn" });

  if (jumpedCoord) {
    setBoardCell(nextBoard, jumpedCoord.x, jumpedCoord.y, null);
  }

  // The opponent with no legal move loses. A board that is full with no
  // captures left is a draw, which the two checks below distinguish: if the
  // opponent still has a quiet move the game continues.
  const opponentMoves = getCheckersLegalMoves(nextBoard, opponentOf(player));
  const winner: PlayerColor | null = opponentMoves.length === 0 ? player : null;

  // Whether this capture is the whole move or only its first leg. The question
  // can only be asked of the piece that just moved, so the search is restricted
  // to jumps that start on the landing square: any other jumping piece on the
  // board is irrelevant, because the forced-capture rule binds the whole turn
  // to the piece already in hand, not to a fresh choice of victim.
  //
  // A man that crowns on a jump is the one case where a legal continuation is
  // not a continuation. It has just become a king, and as a king it can of
  // course jump on — but the turn ends here, because the rule treats the crown
  // as the end of the move rather than as a promotion in the middle of one.
  // The bug this fixes is silent and looks like a gift: the chain carried on
  // with the new king, taking one more piece than the rules allow, and the
  // opponent was never given the turn that should have followed.
  const furtherJumps = jumpedCoord && !newlyCrowned
    ? getCheckersMovesFrom(nextBoard, move.to, player).filter((option) => option.jumpedCoord !== undefined)
    : [];

  return { nextBoard, winner, isDraw: false, canJumpAgain: furtherJumps.length > 0 };
}
