/**
 * Section 3.1.6 — Hex engine (deterministic micro-engine).
 *
 * Hex is the one game of the six whose outcome is decided by a *topology* fact
 * rather than by a rule, and that shapes everything in this file. Two players
 * place stones of their own colour on an empty cell in turn; the first to hold
 * an unbroken chain of their stones between their two opposite sides wins.
 *
 * The board is a rhombus, not a rectangle, and the geometry has to be stated
 * once and only once, because getting it wrong does not produce a crash — it
 * produces a board where the diagonals simply do not connect and a chain that
 * *looks* broken to the player is judged joined by the engine. The convention
 * used here is the standard one: rows are `y = 0 .. 6`, columns are
 * `x = 0 .. 6`, and row `y` is shifted half a cell to the right relative to
 * row `y - 1`. A cell therefore has six neighbours, and only six — see
 * {@link HEX_DIRECTIONS}, which is the single definition of "adjacent" that
 * the win check, the legal-move scan and the board view all read.
 *
 * Black connects the top row (`y = 0`) to the bottom row (`y = 6`); White
 * connects the left column (`x = 0`) to the right column (`x = 6`). Black moves
 * first.
 *
 * There is no draw. Hex has been completely solved (Berlekamp, Conway and Guy,
 * 1990: the first player wins with a strategy that is a strategy, not a
 * search), and more practically, the position in which no stone can be placed is
 * unreachable for a 49-cell board with two players alternating: the board is
 * exhausted only if all 49 cells are taken, and at that point a chain of both
 * colours crossing the board is a contradiction rather than a tie. The engine
 * reports `isDraw: false` unconditionally, and `factory.ts` turns that into
 * `MatchStatus` — so a Hex room can never end in `status: "draw"`, and the UI
 * never has to describe an outcome that cannot occur.
 *
 * Immutability is the other invariant. Every function here copies the board
 * before writing, because the same board object is the one held in React state,
 * serialised into the IndexedDB snapshot, and compared by the replay
 * integrator on the other client. An in-place write would make the local view
 * appear to have moved before the move was ever accepted, and would make a
 * re-serialised snapshot differ from the move log without any move having been
 * made.
 */

import type { Coordinates, HexBoard, HexCell, PlayerColor } from "../types";
import { getBoardCell } from "../types";

export { getBoardCell };

/** Hex is played on a 7x7 rhombus — the size small enough to read on a phone. */
export const HEX_SIZE = 7;

/**
 * The six neighbours of a cell, as `(dy, dx)` offsets.
 *
 * Two axes run through the board — "along a row" (`dy = 0`) and "along a
 * column" (`dy = ±1`) — and because each row is offset half a cell, the third
 * axis (`dy = ±1, dx = ∓1`) is also adjacent. Stating all six in one place is
 * the point: a win that is computed over four directions while the board is
 * *drawn* with six is a bug a player sees and an engine cannot.
 */
export const HEX_DIRECTIONS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, 1],
  [1, -1],
] as const;

export interface HexMoveResult {
  nextBoard: HexBoard;
  winner: PlayerColor | null;
  /** Always `false`. See the module note on the Hex theorem. */
  isDraw: boolean;
}

/** The empty starting position: 49 cells, no stones, no side to move recorded. */
export function createInitialHexBoard(): HexBoard {
  return Array.from({ length: HEX_SIZE }, () =>
    Array<HexCell>(HEX_SIZE).fill(null)
  );
}

/**
 * A row-major copy, with a single cell replaced.
 *
 * Structural sharing would be cheaper, but the board is 49 cells and the copy
 * is made once per move; correctness of the snapshot is worth more here than
 * avoiding the allocation.
 */
function withCell(
  board: HexBoard,
  coord: Coordinates,
  value: HexCell
): HexBoard {
  const next = board.map((row) => row.slice());
  next[coord.y][coord.x] = value;
  return next;
}

function isOnBoard(x: number, y: number): boolean {
  return y >= 0 && y < HEX_SIZE && x >= 0 && x < HEX_SIZE;
}

/** Structural equality. The board is small enough that a full walk is cheapest. */
export function hexBoardsEqual(a: HexBoard, b: HexBoard): boolean {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y += 1) {
    const rowA = a[y];
    const rowB = b[y];
    if (rowA.length !== rowB.length) return false;
    for (let x = 0; x < rowA.length; x += 1) {
      if (rowA[x] !== rowB[x]) return false;
    }
  }
  return true;
}

/**
 * The two edges each colour has to span, as two separate predicates.
 *
 * They have to be separate. A flood-fill seeded from a player's *start* edge
 * will immediately re-encounter that same edge, so a predicate that answers
 * "is this cell on one of my two edges?" reports a win for the single stone
 * the search started from — and for every position that happens to touch its
 * own start edge, which is every position. A cell counts as a win only when it
 * lies on the edge at the *other* end of the span.
 *
 * The two sides are transposes of each other under this rhombus, so they differ
 * only in which pair of edges is named; keeping that in one place means the win
 * check cannot get Black and White mixed up in a way that only shows up in play.
 */
function edgesForPlayer(
  player: PlayerColor
): { readonly onStartEdge: (x: number, y: number) => boolean; readonly onGoalEdge: (x: number, y: number) => boolean } {
  if (player === "black") {
    // North to south: the two horizontal edges.
    return {
      onStartEdge: (_x, y) => y === 0,
      onGoalEdge: (_x, y) => y === HEX_SIZE - 1,
    };
  }
  // West to east: the two vertical edges.
  return {
    onStartEdge: (x) => x === 0,
    onGoalEdge: (x) => x === HEX_SIZE - 1,
  };
}

/**
 * `true` when `player` holds an unbroken chain between their two sides.
 *
 * A breadth-first search from every cell on the player's starting edge, through
 * same-coloured stones only, and each neighbour taken from
 * {@link HEX_DIRECTIONS}. Union-find would be asymptotically the same here and
 * would need the same six offsets; a visited-queue flood reads as the rule it
 * implements, which is the property that matters for a file a future maintainer
 * has to trust.
 */
export function checkHexWin(board: HexBoard, player: PlayerColor): boolean {
  const { onStartEdge, onGoalEdge } = edgesForPlayer(player);
  const queue: Coordinates[] = [];

  for (let y = 0; y < HEX_SIZE; y += 1) {
    for (let x = 0; x < HEX_SIZE; x += 1) {
      if (getBoardCell(board, x, y) !== player) continue;
      if (!onStartEdge(x, y)) continue;
      queue.push({ x, y });
    }
  }

  if (queue.length === 0) return false;

  const seen: boolean[][] = Array.from({ length: HEX_SIZE }, () =>
    Array<boolean>(HEX_SIZE).fill(false)
  );
  for (const start of queue) seen[start.y][start.x] = true;

  while (queue.length > 0) {
    const current = queue.shift() as Coordinates;

    // Tested on dequeue against the *far* edge, so a chain that only ever
    // wanders back along the start edge never satisfies it.
    if (onGoalEdge(current.x, current.y)) return true;

    for (const [dy, dx] of HEX_DIRECTIONS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isOnBoard(nx, ny)) continue;
      if (seen[ny][nx]) continue;
      if (getBoardCell(board, nx, ny) !== player) continue;
      seen[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }

  return false;
}

/** Every empty cell, in row-major order. A Hex move has no origin square. */
export function getHexLegalMoves(board: HexBoard, _player?: PlayerColor): Coordinates[] {
  const moves: Coordinates[] = [];
  for (let y = 0; y < HEX_SIZE; y += 1) {
    for (let x = 0; x < HEX_SIZE; x += 1) {
      if (getBoardCell(board, x, y) === null) moves.push({ x, y });
    }
  }
  return moves;
}

/**
 * Places a stone and resolves the game.
 *
 * The coordinate is validated here rather than trusted: `applyMove` is reachable
 * from a reconstructed move log, and a log is data. An occupied cell or an
 * off-board coordinate throws rather than silently overwriting a stone, because
 * the alternative — the current `nextBoard` and a null winner — would let a
 * corrupt log look like a legal game that is merely still in progress.
 */
export function applyHexMove(
  board: HexBoard,
  coord: Coordinates,
  player: PlayerColor
): HexMoveResult {
  if (!isOnBoard(coord.x, coord.y)) {
    throw new RangeError(
      `Hex move out of bounds: (${coord.x}, ${coord.y}) is not on a ${HEX_SIZE}x${HEX_SIZE} board`
    );
  }
  if (getBoardCell(board, coord.x, coord.y) !== null) {
    throw new Error(
      `Hex cell (${coord.x}, ${coord.y}) is already occupied by ${String(getBoardCell(board, coord.x, coord.y))}`
    );
  }

  const nextBoard = withCell(board, coord, player);
  const winner = checkHexWin(nextBoard, player) ? player : null;

  return { nextBoard, winner, isDraw: false };
}

/** How many stones each side has on the board. Used by the score cards. */
export function countHexStones(board: HexBoard): Record<PlayerColor, number> {
  const counts: Record<PlayerColor, number> = { black: 0, white: 0 };
  for (let y = 0; y < HEX_SIZE; y += 1) {
    for (let x = 0; x < HEX_SIZE; x += 1) {
      const cell = getBoardCell(board, x, y);
      if (cell !== null) counts[cell] += 1;
    }
  }
  return counts;
}

/** Exposed for the board view's top-and-bottom edge accents. */
export function isBlackGoalRow(y: number): boolean {
  return y === 0 || y === HEX_SIZE - 1;
}

/** Exposed for the board view's left-and-right edge accents. */
export function isWhiteGoalColumn(x: number): boolean {
  return x === 0 || x === HEX_SIZE - 1;
}
