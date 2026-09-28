/**
 * Section 3.1.1 — Tic-Tac-Toe engine.
 *
 * Pure functions over a flat 9-cell board. No I/O, no framework imports: the
 * same code runs in a React render pass, in the sync layer and in the
 * reconnect replay.
 *
 * **The game is 3-piece vanishing Tic-Tac-Toe, not the nine-move original.**
 * A player may hold at most {@link TICTACTOE_MARKS_PER_PLAYER} marks at a
 * time, and placing a fourth lifts the oldest of the three off the board first.
 * Two consequences follow, and both are the point of the rule rather than side
 * effects of it:
 *
 *  - **A draw is unreachable.** Six marks is the most the board can hold — three
 *    a side — so at least three cells are always empty and the game never fills.
 *    `isDraw` is therefore a constant `false`, not a check that happens to come
 *    out false.
 *  - **The vanishing order is the order the marks were placed**, which the flat
 *    board cannot record. Cell 0 is not "the oldest mark" because it is the
 *    lowest index; it is the oldest only if the player played it first. The
 *    order comes from the move log, passed in as `playerHistory`, and that is
 *    why the log — not the snapshot — is what the integrity gate replays.
 */

import type { Coordinates, PlayerColor, TicTacToeBoard } from "../types";

export const TICTACTOE_SIZE = 3;
export const TICTACTOE_CELLS = TICTACTOE_SIZE * TICTACTOE_SIZE;

/**
 * Marks one player may hold at once. Placing a fourth removes the oldest.
 *
 * Two players at three apiece occupy six of nine cells, so the board can never
 * be full and a nine-move stalemate cannot arise.
 */
export const TICTACTOE_MARKS_PER_PLAYER = 3;

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
  /**
   * Always `false`. The board cannot fill: each side is capped at three marks,
   * so six of the nine cells are the most that can ever be occupied. The field
   * stays so the status ladder above is uniform across all six games rather
   * than special-casing one of them.
   */
  isDraw: boolean;
  /**
   * Cell the mover's oldest mark vacated to make room for the new one, or
   * `null` when the player held fewer than three marks and nothing moved.
   */
  vanishedIndex: number | null;
  /**
   * The three cells that decided the game, in board order along the line, or
   * `null` while it is undecided. Reported rather than recomputed downstream:
   * which line won is a property of the *move*, and the mark that completed it
   * is the one a player wants shown when the result is read.
   */
  winningLine: Coordinates[] | null;
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

/**
 * The winning line containing the mark just played, or `null` when there is none.
 *
 * `index` is optional, and supplying it is a correctness requirement rather than
 * an optimisation. Omit it and the search runs over all eight lines, which
 * reports a line completed by some *earlier* move that merely still happens to be
 * on the board: the game declares a winner and highlights a column reading
 * `[empty, O, empty]`, because one of the eight triples tests equal. Scoping to
 * the lines through the mark that was just placed leaves only the lines this
 * move could have completed, which is the question being asked.
 */
export function findTicTacToeWinningLine(
  board: TicTacToeBoard,
  index?: number
): readonly [number, number, number] | null {
  for (const line of TICTACTOE_WINNING_LINES) {
    if (index !== undefined && !line.includes(index)) continue;
    const [a, b, c] = line;
    const cell = board[a];
    if (cell !== null && cell === board[b] && cell === board[c]) return line;
  }
  return null;
}

/**
 * The marks `player` currently holds, oldest first.
 *
 * A mark is "currently held" if it is still on the board: a player who has
 * played five marks holds the last three, because the first two were removed by
 * the rule. `playerHistory` is the player's own placements in chronological
 * order and is what makes "oldest" mean oldest rather than lowest-indexed.
 *
 * Without a history — a rule-level call that was handed nothing but a board —
 * the marks are ordered by cell index. That is a deterministic stand-in, not the
 * real rule: it happens to agree with placement order only when a player played
 * their marks in ascending order. Every path inside the app supplies the log,
 * so live play, replay and the integrity gate all see the same order.
 */
export function getTicTacToeActiveMarks(
  board: TicTacToeBoard,
  player: PlayerColor,
  playerHistory?: readonly Coordinates[]
): number[] {
  const inOrder: number[] = [];
  const seen = new Set<number>();

  if (playerHistory) {
    for (const coord of playerHistory) {
      const index = tictactoeIndexOf(coord);
      // A log that names a cell twice, or a cell this player no longer holds,
      // cannot contribute a mark: a vanished mark is gone, and playing the same
      // cell twice never happens under a rule that empties the cell first.
      if (seen.has(index) || board[index] !== player) continue;
      seen.add(index);
      inOrder.push(index);
    }
  } else {
    for (let index = 0; index < TICTACTOE_CELLS; index += 1) {
      if (board[index] === player) inOrder.push(index);
    }
  }

  // The cap is the rule's own invariant rather than a repair: a board holding
  // four of one colour cannot arise from a legal game, and truncating keeps the
  // engine total on a corrupt snapshot instead of reading past it.
  return inOrder.slice(-TICTACTOE_MARKS_PER_PLAYER);
}

/**
 * The mark that leaves the board when `player` places their next one, or `null`
 * when they are not yet holding a full set. The same call drives the rule and
 * the board view's "this one goes" hint, so the highlighted mark is always the
 * mark that actually vanishes.
 */
export function getTicTacToeVanishingIndex(
  board: TicTacToeBoard,
  player: PlayerColor,
  playerHistory?: readonly Coordinates[]
): number | null {
  const active = getTicTacToeActiveMarks(board, player, playerHistory);
  return active.length === TICTACTOE_MARKS_PER_PLAYER ? (active[0] ?? null) : null;
}

export function applyTicTacToeMove(
  board: TicTacToeBoard,
  index: number,
  player: PlayerColor,
  playerHistory?: readonly Coordinates[]
): TicTacToeMoveResult {
  if (!validateTicTacToeMove(board, index)) {
    throw new Error(`Invalid tic-tac-toe move: index ${index} is out of range or occupied`);
  }

  const nextBoard = [...board];
  // Room first, then the mark. Reversing the two would let a player fill the
  // cell their own vanishing mark just vacated and hold four at once.
  const vanishedIndex = getTicTacToeVanishingIndex(board, player, playerHistory);
  if (vanishedIndex !== null) nextBoard[vanishedIndex] = null;
  nextBoard[index] = player;

  // Scoped to the mark just played — see `findTicTacToeWinningLine`. Without the
  // scope this reports a line some earlier move completed and that merely still
  // happens to be on the board, and declares a win for a column that reads
  // `[empty, O, empty]`.
  const winningLineMatch = findTicTacToeWinningLine(nextBoard, index);

  // Cell indices internally, board coordinates outside. Every consumer of a
  // result — the session, the views, the move log — speaks in coordinates, and
  // a nine-cell array index is a tic-tac-toe detail that would leak into all of
  // them if this field kept it.
  //
  // The re-check that the line is the *mover's* is the second half of the same
  // guard: the search answers "is this line full of one colour", and the answer
  // to "is that colour the player who just moved" is the only thing that makes
  // it a win. Reporting a line without it would let an opponent's triple be
  // returned as the mover's victory.
  let winningLine: Coordinates[] | null = null;
  if (winningLineMatch) {
    const [a] = winningLineMatch;
    if (nextBoard[a] === player) {
      winningLine = winningLineMatch.map(tictactoeCoordOf);
    }
  }

  return {
    nextBoard,
    winner: winningLine ? player : null,
    isDraw: false,
    vanishedIndex,
    winningLine,
  };
}
