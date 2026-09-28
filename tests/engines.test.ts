import { describe, expect, it } from "vitest";
import {
  applyTicTacToeMove,
  createInitialTicTacToeBoard,
  findTicTacToeWinningLine,
  getTicTacToeActiveMarks,
  getTicTacToeLegalMoves,
  getTicTacToeVanishingIndex,
  TICTACTOE_CELLS,
  TICTACTOE_MARKS_PER_PLAYER,
  tictactoeCoordOf,
  tictactoeIndexOf,
  validateTicTacToeMove,
} from "@/engine/rules/tictactoe";
import {
  applyConnect4Move,
  CONNECT4_COLS,
  CONNECT4_ROWS,
  createInitialConnect4Board,
  getConnect4LegalMoves,
  getConnect4LowestAvailableRow,
} from "@/engine/rules/connect4";
import {
  applyGomokuMove,
  countGomokuRun,
  createInitialGomokuBoard,
  getGomokuLegalMoves,
  GOMOKU_SIZE,
} from "@/engine/rules/gomoku";
import {
  applyReversiMove,
  countReversiDiscs,
  createInitialReversiBoard,
  getFlipsForMove,
  getValidReversiMoves,
  REVERSI_SIZE,
} from "@/engine/rules/reversi";
import {
  applyCheckersMove,
  CHECKERS_SIZE,
  createInitialCheckersBoard,
  deriveJumpedCoord,
  getCheckersLegalMoves,
  getCheckersMovesFrom,
  isPlayableSquare,
} from "@/engine/rules/checkers";
import {
  applyHexMove,
  checkHexWin,
  createInitialHexBoard,
  getHexLegalMoves,
  HEX_DIRECTIONS,
  HEX_SIZE,
} from "@/engine/rules/hex";
import { getSessionEngine } from "@/engine/factory";
import type {
  CheckersBoard,
  Connect4Board,
  Coordinates,
  GomokuBoard,
  HexBoard,
  PlayerColor,
  ReversiBoard,
  TicTacToeBoard,
} from "@/engine/types";

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                          */
/* -------------------------------------------------------------------------- */

/** Plays `[x, y, player]` triples in order onto a Tic-Tac-Toe board. */
function playTicTacToe(
  moves: readonly (readonly [number, number, "black" | "white"])[],
  start: TicTacToeBoard = createInitialTicTacToeBoard()
): TicTacToeBoard {
  return moves.reduce(
    (board, [x, y, player]) =>
      applyTicTacToeMove(board, tictactoeIndexOf({ x, y }), player).nextBoard,
    start
  );
}

/**
 * Plays a game, threading each side's own placements into the rule exactly the
 * way the session does, and reports every ply.
 *
 * The per-ply record exists because the vanishing mark is a fact about a single
 * move: "which mark went" is only observable on the move that removed it, not
 * on the board afterwards, which looks identical either way.
 */
function playVanishing(moves: readonly (readonly [number, "black" | "white"])[]) {
  const history: { player: "black" | "white"; to: Coordinates }[] = [];
  let board = createInitialTicTacToeBoard();

  const steps = moves.map(([index, player], ply) => {
    const result = applyTicTacToeMove(
      board,
      index,
      player,
      history.filter((entry) => entry.player === player).map((entry) => entry.to)
    );
    history.push({ player, to: tictactoeCoordOf(index) });
    board = result.nextBoard;
    return {
      ply: ply + 1,
      index,
      player,
      result,
      board,
      empty: board.filter((cell) => cell === null).length,
      occupied: board.filter((cell) => cell !== null).length,
    };
  });

  return { steps, board, history };
}

/** The first cell not belonging to `reserved`, as a stable off-line filler. */
function spareCell(reserved: readonly number[]): { x: number; y: number } {
  for (let index = 0; index < 9; index += 1) {
    if (!reserved.includes(index)) return tictactoeCoordOf(index);
  }
  throw new Error("Tic-Tac-Toe has no spare cell");
}

/** An empty `size`x`size` Gomoku board. */
function emptyGomoku(): GomokuBoard {
  return Array.from({ length: GOMOKU_SIZE }, () => Array<GomokuBoard[number][number]>(GOMOKU_SIZE).fill(null));
}

/**
 * Places `coords` for `player` on an empty Gomoku board, interleaving opponent
 * stones on squares that are in neither `coords` nor `keepEmpty`. `coords`
 * therefore holds the run *already on the board*; the test then plays the
 * final stone itself, typically on one of the `keepEmpty` squares.
 */
function gomokuRun(
  coords: readonly Coordinates[],
  player: "black" | "white",
  keepEmpty: readonly Coordinates[] = []
): GomokuBoard {
  let board = emptyGomoku();
  const reserved = new Set([...coords, ...keepEmpty].map((c) => `${c.x},${c.y}`));
  const fillers: Coordinates[] = [];
  for (let y = 0; y < GOMOKU_SIZE; y += 1) {
    for (let x = 0; x < GOMOKU_SIZE; x += 1) {
      if (!reserved.has(`${x},${y}`)) fillers.push({ x, y });
    }
  }
  const opponent = player === "black" ? "white" : "black";
  let fillerIndex = 0;
  for (const coord of coords) {
    board = applyGomokuMove(board, coord, player).nextBoard;
    const filler = fillers[fillerIndex];
    fillerIndex += 1;
    if (filler) board = applyGomokuMove(board, filler, opponent).nextBoard;
  }
  return board;
}

/** An empty `size`x`size` Reversi board. */
function emptyReversi(): ReversiBoard {
  return Array.from({ length: REVERSI_SIZE }, () =>
    Array<ReversiBoard[number][number]>(REVERSI_SIZE).fill(null)
  );
}

/** An empty Checkers board. */
function emptyCheckers(): CheckersBoard {
  return Array.from({ length: CHECKERS_SIZE }, () => Array<CheckersBoard[number][number]>(CHECKERS_SIZE).fill(null));
}

/** An empty Hex board. */
function emptyHex(): HexBoard {
  return Array.from({ length: HEX_SIZE }, () => Array<HexBoard[number][number]>(HEX_SIZE).fill(null));
}

/**
 * Paints a Hex board from `(x, y, colour)` triples.
 *
 * The engine's own `applyHexMove` would refuse to place a stone without also
 * resolving the win condition, which makes it useless for building the
 * *unfinished* positions these tests need. Painting is a fixture, not a rule.
 */
function hexPosition(triples: readonly (readonly [number, number, "black" | "white"])[]): HexBoard {
  const board = emptyHex();
  for (const [x, y, color] of triples) setAt(board, x, y, color);
  return board;
}

/** A `y = 0` to `y = 6` run in one column, plus the white stone that must not help. */
function blackColumn(x: number, breaks: readonly number[] = []): HexBoard {
  const triples: [number, number, "black" | "white"][] = [];
  for (let y = 0; y < HEX_SIZE; y += 1) {
    if (breaks.includes(y)) {
      triples.push([x, y, "white"]);
    } else {
      triples.push([x, y, "black"]);
    }
  }
  return hexPosition(triples);
}

/** An empty 6x7 board painted so that no four-in-a-row exists in any direction. */
function noWinConnect4Board(): Connect4Board {
  // Along a row the value steps by 2 (runs of 2), down a column by 1
  // (alternating), and on either diagonal by 1 or 3 (alternating).
  return Array.from({ length: CONNECT4_ROWS }, (_, y) =>
    Array.from({ length: CONNECT4_COLS }, (_, x) =>
      (y + 2 * x) % 4 < 2 ? ("black" as const) : ("white" as const)
    )
  );
}

/** Sets a cell using (x, y) ordering rather than (y, x) indexing. */
function setAt<T>(board: T[][], x: number, y: number, value: T): void {
  board[y]![x] = value;
}

/** Reads a cell using (x, y) ordering rather than (y, x) indexing. */
function at<T>(board: readonly (readonly T[])[], x: number, y: number): T {
  const cell = board[y]?.[x];
  if (cell === undefined) throw new Error(`No cell at (${x},${y})`);
  return cell;
}
/* -------------------------------------------------------------------------- */
/* Tic-Tac-Toe                                                               */
/* -------------------------------------------------------------------------- */

describe("tic-tac-toe engine", () => {
  it("starts empty with nine legal cells", () => {
    const board = createInitialTicTacToeBoard();
    expect(board).toHaveLength(9);
    expect(board.every((cell) => cell === null)).toBe(true);
    expect(getTicTacToeLegalMoves(board)).toHaveLength(9);
  });

  it("round-trips coordinates through the flat index", () => {
    for (let index = 0; index < 9; index += 1) {
      expect(tictactoeIndexOf(tictactoeCoordOf(index))).toBe(index);
    }
  });

  it("rejects out-of-range and occupied cells", () => {
    const board = playTicTacToe([[0, 0, "black"]]);
    expect(validateTicTacToeMove(board, 0)).toBe(false);
    expect(validateTicTacToeMove(board, -1)).toBe(false);
    expect(validateTicTacToeMove(board, 9)).toBe(false);
    expect(validateTicTacToeMove(board, 4)).toBe(true);
    expect(() => applyTicTacToeMove(board, 0, "white")).toThrow(/occupied/);
  });

  it("shrinks the legal set as cells fill", () => {
    let board = createInitialTicTacToeBoard();
    for (let index = 0; index < 5; index += 1) {
      board = applyTicTacToeMove(board, index, index % 2 === 0 ? "black" : "white").nextBoard;
      expect(getTicTacToeLegalMoves(board)).toHaveLength(8 - index);
    }
  });

  it("does not mutate the input board", () => {
    const board = createInitialTicTacToeBoard();
    applyTicTacToeMove(board, 4, "black");
    expect(board[4]).toBeNull();
  });

  it("detects a win on every row, column and diagonal", () => {
    const lines: readonly (readonly [number, number, number])[] = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];

    for (const [a, b, c] of lines) {
      const board = playTicTacToe([
        [a % 3, Math.floor(a / 3), "black"],
        [b % 3, Math.floor(b / 3), "black"],
      ]);
      const result = applyTicTacToeMove(board, c, "black");
      expect(result.winner, `line ${a}-${b}-${c}`).toBe("black");
      expect(result.isDraw).toBe(false);
      expect(findTicTacToeWinningLine(result.nextBoard, c)).toEqual([a, b, c]);
    }
  });

  it("returns no winning line on a board without one", () => {
    const board = playTicTacToe([
      [0, 0, "black"],
      [1, 0, "white"],
      [0, 1, "black"],
    ]);
    expect(findTicTacToeWinningLine(board, 6)).toBeNull();
  });

  it("never reports a draw, because three marks a side cannot fill nine cells", () => {
    // The old nine-move game ended in a draw when the ninth cell filled a
    // line-free board. That position is now unreachable: a side is capped at
    // three marks, so six is the most the board can hold and three cells are
    // always empty. "Unreachable" is a claim about every ply, so it is asserted
    // over a long game rather than over one position.
    // A deterministic sweep — no dice, so a failure is reproducible — played to
    // its natural end.
    const history: { player: PlayerColor; to: Coordinates }[] = [];
    let board = createInitialTicTacToeBoard();
    let turn: PlayerColor = "black";
    let scan = 0;
    let plies = 0;
    let winner: PlayerColor | null = null;

    while (plies < 20) {
      const index = scan % TICTACTOE_CELLS;
      scan += 1;
      // A cell held by the other side is simply not ours to take; the sweep
      // moves on. Occupied cells cannot pile up, because the cap leaves three.
      if (board[index] !== null) continue;
      const result = applyTicTacToeMove(
        board,
        index,
        turn,
        history.filter((entry) => entry.player === turn).map((entry) => entry.to)
      );

      expect(result.isDraw, `ply ${plies + 1} reported a draw`).toBe(false);
      expect(
        result.nextBoard.filter((cell) => cell === turn).length,
        `ply ${plies + 1} let ${turn} hold more than ${TICTACTOE_MARKS_PER_PLAYER} marks`
      ).toBeLessThanOrEqual(TICTACTOE_MARKS_PER_PLAYER);
      // Three cells empty means the board is still playable: no stalemate, and
      // no position in which the only honest answer is "nobody won".
      expect(result.nextBoard.filter((cell) => cell === null).length).toBeGreaterThanOrEqual(3);

      board = result.nextBoard;
      history.push({ player: turn, to: tictactoeCoordOf(index) });
      if (result.winner) {
        winner = result.winner;
        break;
      }
      turn = turn === "black" ? "white" : "black";
      plies += 1;
    }

    // The payoff: a game of this shape cannot end any other way. The old rules
    // had a reachable drawn ending; this one ends in a line or it goes on.
    expect(winner).not.toBeNull();
    expect(plies).toBeGreaterThanOrEqual(6);
  });

  it("plays a side's first three marks exactly as before the rule existed", () => {
    // The cap only bites on a fourth mark, so an ordinary opening is untouched:
    // nothing vanishes and the legal set is simply the cells still empty.
    const { steps, board } = playVanishing([
      [0, "black"],
      [8, "white"],
      [2, "black"],
      [6, "white"],
      [4, "black"],
    ]);

    for (const step of steps) expect(step.result.vanishedIndex).toBeNull();
    // b _ b / _ b _ / w _ w
    expect(board).toEqual([
      "black", null, "black",
      null, "black", null,
      "white", null, "white",
    ]);
    expect(getTicTacToeLegalMoves(board)).toHaveLength(4);
  });

  it("lifts a player's oldest mark when they play a fourth", () => {
    const { steps, board } = playVanishing([
      [0, "black"],
      [8, "white"],
      [2, "black"],
      [6, "white"],
      [4, "black"],
      [1, "black"],
    ]);

    const fourth = steps[steps.length - 1]!;
    // The first mark black ever played, not the lowest number on the board.
    expect(fourth.result.vanishedIndex).toBe(0);
    expect(fourth.result.nextBoard[0]).toBeNull();
    expect(fourth.result.nextBoard[1]).toBe("black");
    // Still exactly three, and never four: the cap is what the rule exists for.
    expect(board.filter((cell) => cell === "black")).toHaveLength(TICTACTOE_MARKS_PER_PLAYER);
    // White is untouched by the other side's vanish.
    expect(board[8]).toBe("white");
    expect(board[6]).toBe("white");
  });

  it("vanishes the oldest mark, not the lowest-indexed one", () => {
    // The distinction the whole rule turns on. Black plays 8, then 2, then 4,
    // and a fourth at 0. Cell 8 was played first, so it is the mark that goes —
    // even though cell 0 is the lowest index and is the cell being played *now*.
    // An engine that read the board instead of the log would remove cell 0
    // itself, and the player would watch their first mark survive and their
    // fourth vanish, which is the bug in a form no test of the win condition
    // would catch.
    const { steps } = playVanishing([
      [8, "black"],
      [0, "white"],
      [2, "black"],
      [1, "white"],
      [4, "black"],
      [3, "white"],
      [5, "black"],
    ]);

    const fourth = steps[steps.length - 1]!;
    expect(fourth.result.vanishedIndex).toBe(8);
    expect(fourth.result.nextBoard[8]).toBeNull();
    // The mark played *now* survives; the one played first is the one that goes.
    expect(fourth.result.nextBoard[5]).toBe("black");
    // And the reading that needs no log would have named cell 2, a mark that
    // stays put. The two answers differ on this position, which is the point.
    expect(getTicTacToeVanishingIndex(fourth.result.nextBoard, "black", [0, 2, 4, 5].map(tictactoeCoordOf)))
      .toBe(2);
  });

  it("reads the vanishing order from the log, not from the cell numbers", () => {
    // Both readings are asserted side by side, because they agree on most
    // positions and only part company here. Given a board alone the engine has
    // to fall back to index order, which is deterministic but is not the rule;
    // given the log it lifts the mark that was played first.
    // w _ b / _ b _ / w _ b — black's three marks are at 2, 4 and 8, and the
    // log says 8 came first.
    const history = [tictactoeCoordOf(8), tictactoeCoordOf(2), tictactoeCoordOf(4)];
    const board: TicTacToeBoard = [
      "white", null, "black",
      null, "black", null,
      "white", null, "black",
    ];

    expect(getTicTacToeActiveMarks(board, "black", history)).toEqual([8, 2, 4]);
    expect(getTicTacToeVanishingIndex(board, "black", history)).toBe(8);
    // Handed the same board and no log, the engine must still answer with a
    // mark — but cell 2, the lowest index, which is not the mark the log names.
    // The fallback exists so a bare rule call stays total; every path in the
    // app passes the log, and this assertion is what would notice if one forgot.
    expect(getTicTacToeVanishingIndex(board, "black")).toBe(2);
  });

  it("keeps the queue moving past a player's fifth mark", () => {
    // Five placements for a side. The first is lifted by the fourth and the
    // second by the fifth, so the mark that goes is the second one played — a
    // queue that reset each turn would lift the wrong square from here on.
    const { steps, board } = playVanishing([
      [8, "black"],
      [1, "white"],
      [2, "black"],
      [3, "white"],
      [4, "black"],
      [5, "white"],
      [0, "black"],
      [7, "white"],
      [6, "black"],
    ]);

    // Black's fourth mark is his sixth ply, his fifth is his ninth.
    const fourth = steps[6]!;
    const fifth = steps[8]!;
    expect(fourth.result.vanishedIndex).toBe(8);
    expect(fifth.result.vanishedIndex).toBe(2);
    expect(board[8]).toBeNull();
    expect(board[2]).toBeNull();
    expect(board.filter((cell) => cell === "black")).toHaveLength(TICTACTOE_MARKS_PER_PLAYER);
  });

  it("decides a win on a board that has just lost a mark", () => {
    // Black holds 4, 6 and 8 — no line, and no line can exist: 4 is opposite 6
    // and 8. Playing 7 is a fourth mark, so black's own first mark comes off the
    // board, and the bottom row is then a line of three. The vanish happens
    // first, so a win has to be read off the board the move really produced.
    const { steps } = playVanishing([
      [4, "black"],
      [0, "white"],
      [6, "black"],
      [1, "white"],
      [8, "black"],
      [3, "white"],
      [7, "black"],
    ]);

    const last = steps[steps.length - 1]!;
    expect(last.result.vanishedIndex).toBe(4);
    expect(last.result.winner).toBe("black");
    expect(last.result.isDraw).toBe(false);
    expect(findTicTacToeWinningLine(last.result.nextBoard, 7)).toEqual([6, 7, 8]);
  });

  it("keeps the filler cell off the winning line", () => {
    const filler = spareCell([0, 1, 2]);
    const board = playTicTacToe([
      [0, 0, "black"],
      [1, 0, "white"],
      [filler.x, filler.y, "white"],
    ]);
    expect(findTicTacToeWinningLine(board, 2)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Connect Four                                                              */
/* -------------------------------------------------------------------------- */

describe("connect four engine", () => {
  it("starts as a 6x7 grid of empties", () => {
    const board = createInitialConnect4Board();
    expect(board).toHaveLength(CONNECT4_ROWS);
    expect(board[0]).toHaveLength(CONNECT4_COLS);
    expect(getConnect4LegalMoves(board)).toHaveLength(CONNECT4_COLS);
  });

  it("drops to the lowest free row and reports it", () => {
    let board = createInitialConnect4Board();
    expect(getConnect4LowestAvailableRow(board, 3)).toBe(5);
    board = applyConnect4Move(board, 3, "black").nextBoard;
    expect(board[5][3]).toBe("black");
    expect(getConnect4LowestAvailableRow(board, 3)).toBe(4);
  });

  it("returns -1 and omits a full column from the legal set", () => {
    let board = createInitialConnect4Board();
    for (let i = 0; i < CONNECT4_ROWS; i += 1) {
      board = applyConnect4Move(board, 0, i % 2 === 0 ? "black" : "white").nextBoard;
    }
    expect(getConnect4LowestAvailableRow(board, 0)).toBe(-1);
    expect(getConnect4LegalMoves(board)).toHaveLength(CONNECT4_COLS - 1);
    expect(getConnect4LegalMoves(board).some((m) => m.x === 0)).toBe(false);
  });

  it("throws on a full column and on an out-of-range column", () => {
    let board = createInitialConnect4Board();
    for (let i = 0; i < CONNECT4_ROWS; i += 1) {
      board = applyConnect4Move(board, 0, i % 2 === 0 ? "black" : "white").nextBoard;
    }
    expect(() => applyConnect4Move(board, 0, "black")).toThrow(/fully occupied/);
    expect(() => applyConnect4Move(createInitialConnect4Board(), -1, "black")).toThrow(/out of range/);
    expect(() => applyConnect4Move(createInitialConnect4Board(), 7, "black")).toThrow(/out of range/);
  });

  it("returns the landing row in the legal move set", () => {
    const board = applyConnect4Move(createInitialConnect4Board(), 2, "black").nextBoard;
    const moves = getConnect4LegalMoves(board);
    expect(moves.find((m) => m.x === 2)).toEqual({ x: 2, y: 4 });
    expect(moves.find((m) => m.x === 0)).toEqual({ x: 0, y: 5 });
  });

  it("wins on a horizontal run of four", () => {
    let board = createInitialConnect4Board();
    for (const [col, player] of [
      [0, "black"],
      [0, "white"],
      [1, "black"],
      [1, "white"],
      [2, "black"],
      [2, "white"],
    ] as const) {
      board = applyConnect4Move(board, col, player).nextBoard;
    }
    const result = applyConnect4Move(board, 3, "black");
    expect(result.winner).toBe("black");
    expect(result.placedRow).toBe(5);
  });

  it("wins on a vertical run of four", () => {
    let board = createInitialConnect4Board();
    for (let i = 0; i < 3; i += 1) {
      board = applyConnect4Move(board, 0, "black").nextBoard;
      board = applyConnect4Move(board, 1, "white").nextBoard;
    }
    const result = applyConnect4Move(board, 0, "black");
    expect(result.winner).toBe("black");
    expect(result.placedRow).toBe(2);
  });

  it("wins on an ascending diagonal run of four", () => {
    let board = createInitialConnect4Board();
    const plan: readonly (readonly [number, "black" | "white"])[] = [
      [0, "black"],
      [5, "white"],
      [1, "black"],
      [6, "white"],
      [2, "black"],
      [6, "white"],
    ];
    for (const [col, player] of plan) board = applyConnect4Move(board, col, player).nextBoard;
    expect(applyConnect4Move(board, 3, "black").winner).toBe("black");
  });

  it("wins on a descending diagonal run of four", () => {
    // Black lands on (0,2) (1,3) (2,4) (3,5); white fills the columns below.
    let board = createInitialConnect4Board();
    const plan: readonly (readonly [number, "black" | "white"])[] = [
      [3, "black"],
      [2, "white"],
      [1, "white"],
      [0, "white"],
      [2, "black"],
      [1, "white"],
      [0, "white"],
      [1, "black"],
      [0, "white"],
    ];
    for (const [col, player] of plan) board = applyConnect4Move(board, col, player).nextBoard;
    const result = applyConnect4Move(board, 0, "black");
    expect(result.placedRow).toBe(2);
    expect(result.winner).toBe("black");
  });

  it("does not treat a run of three as a win", () => {
    let board = createInitialConnect4Board();
    for (let i = 0; i < 3; i += 1) {
      board = applyConnect4Move(board, i, "black").nextBoard;
      board = applyConnect4Move(board, 6, "white").nextBoard;
    }
    expect(board[5]?.slice(0, 3)).toEqual(["black", "black", "black"]);
  });

  it("does not mutate the input board", () => {
    const board = createInitialConnect4Board();
    applyConnect4Move(board, 0, "black");
    expect(board[5]?.[0]).toBeNull();
  });

  it("declares a draw when the top row fills without a four-in-a-row", () => {
    // The 4-period pattern admits no four-in-a-row in any direction, so the
    // single drop that tops out the last column leaves a full, drawn board.
    const board = noWinConnect4Board();
    const lastCol = CONNECT4_COLS - 1;
    expect(board[0]![lastCol]).toBe("black");
    board[0]![lastCol] = null;
    expect(board[0]?.some((cell) => cell === null)).toBe(true);

    const result = applyConnect4Move(board, lastCol, "black");
    expect(result.placedRow).toBe(0);
    expect(result.winner).toBeNull();
    expect(result.isDraw).toBe(true);
    expect(result.nextBoard.every((row) => row.every((cell) => cell !== null))).toBe(true);
  });

  it("is not a draw while the top row is still open", () => {
    const board = noWinConnect4Board();
    // Two holes in the top row: the drop fills one, the other keeps it open.
    const hole = CONNECT4_COLS - 2;
    const stillOpen = CONNECT4_COLS - 1;
    expect(board[0]![hole]).toBe("white");
    expect(board[0]![stillOpen]).toBe("black");
    board[0]![hole] = null;
    board[0]![stillOpen] = null;

    const result = applyConnect4Move(board, hole, "white");
    expect(result.placedRow).toBe(0);
    expect(result.winner).toBeNull();
    expect(result.isDraw).toBe(false);
    expect(result.nextBoard[0]?.[stillOpen]).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Gomoku                                                                    */
/* -------------------------------------------------------------------------- */

describe("gomoku engine", () => {
  it("starts as a 15x15 grid of empties", () => {
    const board = createInitialGomokuBoard();
    expect(board).toHaveLength(GOMOKU_SIZE);
    expect(board.every((row) => row.every((cell) => cell === null))).toBe(true);
    expect(getGomokuLegalMoves(board)).toHaveLength(GOMOKU_SIZE * GOMOKU_SIZE);
  });

  it("rejects an occupied intersection and an off-board one", () => {
    const board = applyGomokuMove(createInitialGomokuBoard(), { x: 7, y: 7 }, "black").nextBoard;
    expect(() => applyGomokuMove(board, { x: 7, y: 7 }, "white")).toThrow(/occupied/);
    expect(() => applyGomokuMove(board, { x: 15, y: 0 }, "white")).toThrow(/occupied or outside/);
    expect(() => applyGomokuMove(board, { x: -1, y: 0 }, "white")).toThrow(/occupied or outside/);
  });

  it("does not mutate the input board", () => {
    const board = createInitialGomokuBoard();
    applyGomokuMove(board, { x: 7, y: 7 }, "black");
    expect(board[7]?.[7]).toBeNull();
  });

  it("wins with five in a row on all four axes", () => {
    const axes: readonly (readonly [number, number])[] = [
      [0, 1], // horizontal
      [1, 0], // vertical
      [1, 1], // descending
      [1, -1], // ascending
    ];

    for (const [dy, dx] of axes) {
      const run = Array.from({ length: 5 }, (_, i) => ({ x: 7 + dx * i, y: 7 + dy * i }));
      const board = gomokuRun(run.slice(0, 4), "black");
      const result = applyGomokuMove(board, run[4]!, "black");
      expect(result.winner, `axis dy=${dy} dx=${dx}`).toBe("black");
      expect(result.isDraw).toBe(false);
    }
  });

  it("wins when the completing stone lands in the middle of the run", () => {
    const board = gomokuRun(
      [
        { x: 3, y: 3 },
        { x: 4, y: 3 },
        { x: 6, y: 3 },
        { x: 7, y: 3 },
      ],
      "black"
    );
    const result = applyGomokuMove(board, { x: 5, y: 3 }, "black");
    expect(result.winner).toBe("black");
  });

  it("counts the whole run through the completing stone", () => {
    const board = gomokuRun(
      [
        { x: 3, y: 4 },
        { x: 4, y: 4 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
      ],
      "black"
    );
    const withFifth = applyGomokuMove(board, { x: 7, y: 4 }, "black");
    expect(withFifth.winner).toBe("black");
    expect(countGomokuRun(withFifth.nextBoard, { x: 7, y: 4 }, "black", 0, 1)).toBe(5);
    // The same run counted from the far end sees the same stones.
    expect(countGomokuRun(withFifth.nextBoard, { x: 3, y: 4 }, "black", 0, 1)).toBe(5);
  });

  it("does not win on four in a row", () => {
    const board = gomokuRun(
      [
        { x: 4, y: 4 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
      ],
      "black"
    );
    const result = applyGomokuMove(board, { x: 7, y: 4 }, "black");
    expect(result.winner).toBeNull();
    expect(result.isDraw).toBe(false);
  });

  it("caps a run at the board edge instead of wrapping", () => {
    const board = gomokuRun(
      [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ],
      "black",
      [{ x: 0, y: 0 }]
    );
    const result = applyGomokuMove(board, { x: 0, y: 0 }, "black");
    expect(result.winner).toBe("black");
    expect(countGomokuRun(result.nextBoard, { x: 0, y: 0 }, "black", 0, 1)).toBe(5);
  });

  it("wins a run that abuts the far edge", () => {
    const board = gomokuRun(
      [
        { x: 11, y: 7 },
        { x: 12, y: 7 },
        { x: 13, y: 7 },
        { x: 14, y: 7 },
      ],
      "black"
    );
    expect(applyGomokuMove(board, { x: 10, y: 7 }, "black").winner).toBe("black");
  });

  it("does not let a run at the edge wrap onto the next row", () => {
    const board = gomokuRun(
      [
        { x: 11, y: 0 },
        { x: 12, y: 0 },
        { x: 13, y: 0 },
        { x: 14, y: 0 },
      ],
      "black",
      [{ x: 10, y: 0 }]
    );
    const result = applyGomokuMove(board, { x: 10, y: 0 }, "black");
    expect(result.winner).toBe("black");
    // A wrapped read would also pick up (0,1); the real run stops at five.
    expect(countGomokuRun(result.nextBoard, { x: 10, y: 0 }, "black", 0, 1)).toBe(5);
  });

  it("wins for white on the same axis rules", () => {
    const board = gomokuRun(
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
        { x: 0, y: 3 },
      ],
      "white"
    );
    expect(applyGomokuMove(board, { x: 0, y: 4 }, "white").winner).toBe("white");
  });
});

/* -------------------------------------------------------------------------- */
/* Reversi                                                                   */
/* -------------------------------------------------------------------------- */

describe("reversi engine", () => {
  it("opens with the standard four-disc centre", () => {
    const board = createInitialReversiBoard();
    expect(countReversiDiscs(board)).toEqual({ black: 2, white: 2 });
    expect(board[3]?.[3]).toBe("white");
    expect(board[3]?.[4]).toBe("black");
    expect(board[4]?.[3]).toBe("black");
    expect(board[4]?.[4]).toBe("white");
  });

  it("offers exactly the four opening replies for black", () => {
    const moves = getValidReversiMoves(createInitialReversiBoard(), "black");
    expect(moves.map((m) => `${m.x},${m.y}`).sort()).toEqual(["2,3", "3,2", "4,5", "5,4"]);
    expect(getValidReversiMoves(createInitialReversiBoard(), "white")).toHaveLength(4);
  });

  it("flips exactly the bracketed disc on an opening move", () => {
    const board = createInitialReversiBoard();
    expect(getFlipsForMove(board, { x: 2, y: 3 }, "black")).toEqual([{ x: 3, y: 3 }]);

    const result = applyReversiMove(board, { x: 2, y: 3 }, "black");
    expect(result.nextBoard[3]?.[2]).toBe("black");
    expect(result.nextBoard[3]?.[3]).toBe("black");
    expect(countReversiDiscs(result.nextBoard)).toEqual({ black: 4, white: 1 });
  });

  it("returns no flips for an occupied, empty or off-board square", () => {
    const board = createInitialReversiBoard();
    expect(getFlipsForMove(board, { x: 3, y: 3 }, "black")).toEqual([]);
    expect(getFlipsForMove(board, { x: 0, y: 0 }, "black")).toEqual([]);
    expect(getFlipsForMove(board, { x: 99, y: 0 }, "black")).toEqual([]);
    expect(getFlipsForMove(board, { x: 0, y: -1 }, "black")).toEqual([]);
    expect(() => applyReversiMove(board, { x: 0, y: 0 }, "black")).toThrow(/no pieces flipped/);
  });

  it("does not mutate the input board", () => {
    const board = createInitialReversiBoard();
    applyReversiMove(board, { x: 2, y: 3 }, "black");
    expect(board[3]?.[3]).toBe("white");
  });

  it("flips along all four orthogonal rays at once", () => {
    const board = emptyReversi();
    for (const [dy, dx] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      setAt(board, 4 + dx, 4 + dy, "white");
      setAt(board, 4 + dx * 2, 4 + dy * 2, "black");
    }
    const flips = getFlipsForMove(board, { x: 4, y: 4 }, "black");
    expect(flips).toHaveLength(4);
    expect(flips.map((f) => `${f.x},${f.y}`).sort()).toEqual(["3,4", "4,3", "4,5", "5,4"]);
  });

  it("flips along all eight rays at once", () => {
    const board = emptyReversi();
    for (const [dy, dx] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      setAt(board, 4 + dx, 4 + dy, "white");
      setAt(board, 4 + dx * 2, 4 + dy * 2, "black");
    }
    expect(getFlipsForMove(board, { x: 4, y: 4 }, "black")).toHaveLength(8);
  });

  it("flips a run of three from the board edge", () => {
    // A lone bracketed ray needs the empty square at an edge of the line.
    const board = emptyReversi();
    for (let x = 1; x <= 3; x += 1) setAt(board, x, 4, "white");
    setAt(board, 4, 4, "black");

    const flips = getFlipsForMove(board, { x: 0, y: 4 }, "black");
    expect(flips.map((f) => f.x)).toEqual([1, 2, 3]);
  });

  it("stops flipping when the ray ends on an empty square", () => {
    const board = emptyReversi();
    setAt(board, 3, 4, "white");
    // (4,4) is left empty, so the run from (2,4) never closes.
    expect(getFlipsForMove(board, { x: 2, y: 4 }, "black")).toEqual([]);
  });

  it("stops flipping when the ray reaches the mover's own piece", () => {
    const board = emptyReversi();
    setAt(board, 3, 4, "white");
    setAt(board, 4, 4, "black");
    setAt(board, 5, 4, "black");
    // Only the first ray closes; the two own stones stop nothing further.
    expect(getFlipsForMove(board, { x: 2, y: 4 }, "black")).toEqual([{ x: 3, y: 4 }]);
  });

  it("stops flipping when the ray runs off the board", () => {
    const board = emptyReversi();
    for (let x = 1; x < REVERSI_SIZE; x += 1) setAt(board, x, 4, "white");
    expect(getFlipsForMove(board, { x: 0, y: 4 }, "black")).toEqual([]);
  });

  it("reports nextTurnHasValidMoves false while the mover still has replies", () => {
    // Ray A is black's only move; ray B is a black reply that survives it.
    // After black plays (4,3), white has no disc left to bracket anything.
    const board = emptyReversi();
    setAt(board, 1, 4, "black");
    setAt(board, 2, 4, "white");
    setAt(board, 0, 0, "black");
    setAt(board, 1, 0, "white");

    const result = applyReversiMove(board, { x: 3, y: 4 }, "black");
    expect(result.nextTurnHasValidMoves).toBe(false);
    expect(result.winner).toBeNull();
    expect(result.isDraw).toBe(false);
    // Black retains a legal move, so the game is not over.
    expect(getValidReversiMoves(result.nextBoard, "black")).toHaveLength(1);
  });

  it("decides the game by disc count when the board fills", () => {
    const board = emptyReversi();
    for (let y = 0; y < REVERSI_SIZE; y += 1) {
      for (let x = 0; x < REVERSI_SIZE; x += 1) {
        const flat = y * REVERSI_SIZE + x;
        setAt(board, x, y, flat < 32 ? "black" : flat < 63 ? "white" : null);
      }
    }
    const result = applyReversiMove(board, { x: 7, y: 7 }, "black");
    expect(result.winner).toBe("black");
    expect(result.isDraw).toBe(false);
    expect(result.nextTurnHasValidMoves).toBe(false);
    expect(countReversiDiscs(result.nextBoard).black).toBeGreaterThan(
      countReversiDiscs(result.nextBoard).white
    );
  });

  it("declares a draw when the final fill leaves the disc counts level", () => {
    // 30 black, 33 white and one empty. Every ray leaving (7,7) is dead
    // except the one running left — (6,7) white closed by (5,7) black — so
    // exactly one disc flips and the counts finish level at 32 apiece.
    const board = emptyReversi();
    for (let y = 0; y < REVERSI_SIZE - 1; y += 1) setAt(board, 7, y, "black");
    setAt(board, 6, 6, "black");
    setAt(board, 5, 7, "black");
    for (let x = 0; x <= 4; x += 1) setAt(board, x, 7, "white");
    setAt(board, 6, 7, "white");
    setAt(board, 7, 7, null);

    const fixed = new Set(["7,0", "7,1", "7,2", "7,3", "7,4", "7,5", "7,6", "6,6", "5,7"]);
    for (let y = 0; y < REVERSI_SIZE; y += 1) {
      for (let x = 0; x < REVERSI_SIZE; x += 1) {
        if (fixed.has(`${x},${y}`) || y === 7) continue;
        setAt(board, x, y, countReversiDiscs(board).black < 30 ? "black" : "white");
      }
    }

    expect(countReversiDiscs(board)).toEqual({ black: 30, white: 33 });
    expect(at(board, 7, 7)).toBeNull();

    const result = applyReversiMove(board, { x: 7, y: 7 }, "black");
    expect(result.isDraw).toBe(true);
    expect(result.winner).toBeNull();
    expect(countReversiDiscs(result.nextBoard)).toEqual({ black: 32, white: 32 });
  });
});

/* -------------------------------------------------------------------------- */
/* Checkers                                                                  */
/* -------------------------------------------------------------------------- */

describe("checkers engine", () => {
  it("opens with 12 pieces per side, all on playable squares", () => {
    const board = createInitialCheckersBoard();
    expect(board.flat().filter((c) => c?.color === "black")).toHaveLength(12);
    expect(board.flat().filter((c) => c?.color === "white")).toHaveLength(12);

    for (let y = 0; y < CHECKERS_SIZE; y += 1) {
      for (let x = 0; x < CHECKERS_SIZE; x += 1) {
        const piece = board[y]![x];
        if (piece === null) continue;
        expect(isPlayableSquare(x, y), `(${x},${y})`).toBe(true);
      }
    }
  });

  it("marks only odd-parity squares as playable", () => {
    expect(isPlayableSquare(1, 0)).toBe(true);
    expect(isPlayableSquare(0, 0)).toBe(false);
    expect(isPlayableSquare(-1, 0)).toBe(false);
    expect(isPlayableSquare(0, CHECKERS_SIZE)).toBe(false);
  });

  it("re-derives the jumped square from the endpoints", () => {
    expect(deriveJumpedCoord({ x: 1, y: 3 }, { x: 3, y: 5 })).toEqual({ x: 2, y: 4 });
    expect(deriveJumpedCoord({ x: 1, y: 3 }, { x: 2, y: 4 })).toBeUndefined();
    expect(deriveJumpedCoord({ x: 1, y: 3 }, { x: 1, y: 5 })).toBeUndefined();
    // Only the row difference decides a jump; the file difference is free.
    expect(deriveJumpedCoord({ x: 1, y: 3 }, { x: 3, y: 1 })).toEqual({ x: 2, y: 2 });
  });

  it("forces a capture over an available quiet move", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "white", type: "pawn" };
    board[5]![0] = { color: "black", type: "pawn" };
    board[4]![1] = null;

    const moves = getCheckersLegalMoves(board, "black");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({ from: { x: 1, y: 1 }, to: { x: 3, y: 3 }, jumpedCoord: { x: 2, y: 2 } });
  });

  it("removes the captured piece and relocates the man", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "white", type: "pawn" };

    const result = applyCheckersMove(
      board,
      { from: { x: 1, y: 1 }, to: { x: 3, y: 3 }, jumpedCoord: { x: 2, y: 2 } },
      "black"
    );
    expect(result.nextBoard[1]![1]).toBeNull();
    expect(result.nextBoard[2]![2]).toBeNull();
    expect(result.nextBoard[3]![3]).toEqual({ color: "black", type: "pawn" });
    expect(board[1]![1]).not.toBeNull();
  });

  it("reports a chain that is not finished, and holds the turn for it", () => {
    // The rule: a capture is not over because the man has landed. With a second
    // white piece ahead, this is the first leg of a chain, and the engine has to
    // say so — otherwise the turn passes and the player has to hand the move
    // back to finish a jump they were never allowed to stop.
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "white", type: "pawn" };
    board[4]![4] = { color: "white", type: "pawn" };

    const first = applyCheckersMove(
      board,
      { from: { x: 1, y: 1 }, to: { x: 3, y: 3 }, jumpedCoord: { x: 2, y: 2 } },
      "black"
    );
    expect(first.canJumpAgain).toBe(true);
    expect(first.winner).toBeNull();

    // And the chain really is available, from the square the man is on now.
    const next = getCheckersLegalMoves(first.nextBoard, "black");
    expect(next).toEqual([{ from: { x: 3, y: 3 }, to: { x: 5, y: 5 }, jumpedCoord: { x: 4, y: 4 } }]);

    const second = applyCheckersMove(
      first.nextBoard,
      { from: { x: 3, y: 3 }, to: { x: 5, y: 5 }, jumpedCoord: { x: 4, y: 4 } },
      "black"
    );
    // The last leg: nothing left to jump, so the turn finally goes over.
    expect(second.canJumpAgain).toBe(false);
  });

  it("ends a chain the moment the man has nowhere left to jump", () => {
    // The same chain with the second victim missing. The man has taken one
    // piece and the board has one white piece left with a quiet move, so this
    // is a complete move — a flag that stayed true here would strand the player
    // holding a piece that has nothing to do.
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "white", type: "pawn" };
    board[6]![6] = { color: "white", type: "pawn" };

    const result = applyCheckersMove(
      board,
      { from: { x: 1, y: 1 }, to: { x: 3, y: 3 }, jumpedCoord: { x: 2, y: 2 } },
      "black"
    );
    expect(result.canJumpAgain).toBe(false);
  });

  it("ends the turn when the man crowns on a jump, even though the new king can jump", () => {
    // Black's man at b5 jumps a white piece on a6 and lands on c7, the king row.
    // The man is now a king, and a king on c7 has an obvious capture left: the
    // white piece on d6 is there for it to take.
    //
    // The rule stops the move at the crown anyway. The bug this pins is that it
    // did not: the chain carried on with the new king, so black took a second
    // piece that the rules never allowed, white never received the turn, and
    // the whole position after the crowning jump was a board no opponent had
    // agreed to.
    const board = emptyCheckers();
    board[5]![0] = { color: "black", type: "pawn" };
    board[6]![1] = { color: "white", type: "pawn" };
    board[6]![3] = { color: "white", type: "pawn" };

    const result = applyCheckersMove(
      board,
      { from: { x: 0, y: 5 }, to: { x: 2, y: 7 }, jumpedCoord: { x: 1, y: 6 } },
      "black"
    );

    // It is a king, and the capture it made is off the board already.
    expect(result.nextBoard[7]![2]).toEqual({ color: "black", type: "king" });
    expect(result.nextBoard[6]![1]).toBeNull();
    expect(result.nextBoard[5]![0]).toBeNull();
    // The captured piece is gone from this ply, not at the end of the chain:
    // there is no chain to end.
    expect(result.nextBoard[6]![3]).toEqual({ color: "white", type: "pawn" });

    // The turn is over.
    expect(result.canJumpAgain).toBe(false);

    // And the continuation really was available to the crowned king, so the
    // assertion above is about the rule rather than about a board with nothing
    // left to take.
    const available = getCheckersMovesFrom(result.nextBoard, { x: 2, y: 7 }, "black");
    expect(available).toEqual([
      { from: { x: 2, y: 7 }, to: { x: 4, y: 5 }, jumpedCoord: { x: 3, y: 6 } },
    ]);
  });

  it("still continues a chain that a king finishes on the king row", () => {
    // The same geometry, played by a piece that was already a king. Crowning is
    // a change of rank; a king that lands on the king row has not changed, and
    // its chain continues exactly as before the crowning rule existed.
    const board = emptyCheckers();
    board[5]![0] = { color: "black", type: "king" };
    board[6]![1] = { color: "white", type: "pawn" };
    board[6]![3] = { color: "white", type: "pawn" };

    const result = applyCheckersMove(
      board,
      { from: { x: 0, y: 5 }, to: { x: 2, y: 7 }, jumpedCoord: { x: 1, y: 6 } },
      "black"
    );

    expect(result.nextBoard[7]![2]).toEqual({ color: "black", type: "king" });
    expect(result.canJumpAgain).toBe(true);
  });

  it("keeps crowning a man that walks onto the king row without a capture", () => {
    // The crowning rule itself is unchanged: a quiet move to the far row still
    // makes a king, it simply has no chain to end.
    const board = emptyCheckers();
    board[6]![0] = { color: "black", type: "pawn" };

    const result = applyCheckersMove(
      board,
      { from: { x: 0, y: 6 }, to: { x: 1, y: 7 } },
      "black"
    );

    expect(result.nextBoard[7]![1]).toEqual({ color: "black", type: "king" });
    expect(result.canJumpAgain).toBe(false);
  });

  it("ends white's turn on the near king row, symmetrically", () => {
    // White crowns on row 0, and the same rule applies there. A rule that was
    // only fixed for the side that happens to move up the board is not fixed.
    const board = emptyCheckers();
    board[2]![7] = { color: "white", type: "pawn" };
    board[1]![6] = { color: "black", type: "pawn" };
    board[1]![4] = { color: "black", type: "pawn" };

    const result = applyCheckersMove(
      board,
      { from: { x: 7, y: 2 }, to: { x: 5, y: 0 }, jumpedCoord: { x: 6, y: 1 } },
      "white"
    );

    expect(result.nextBoard[0]![5]).toEqual({ color: "white", type: "king" });
    expect(result.canJumpAgain).toBe(false);
    // A capture is available to the new king — over d3, on to c2 — and is not
    // taken.
    expect(getCheckersMovesFrom(result.nextBoard, { x: 5, y: 0 }, "white")).toEqual([
      { from: { x: 5, y: 0 }, to: { x: 3, y: 2 }, jumpedCoord: { x: 4, y: 1 } },
    ]);
  });

  it("does not confuse another piece's jump for a continuation of this one", () => {
    // The forced-capture rule binds the whole turn to the piece already in
    // hand, so a second black man with a jump of its own is irrelevant: the
    // chain continues from where the man landed or not at all.
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "white", type: "pawn" };
    // A separate black man with a jump available to it on the far side.
    board[1]![5] = { color: "black", type: "pawn" };
    board[2]![4] = { color: "white", type: "pawn" };

    const result = applyCheckersMove(
      board,
      { from: { x: 1, y: 1 }, to: { x: 3, y: 3 }, jumpedCoord: { x: 2, y: 2 } },
      "black"
    );
    // The other man can jump — from (1,5) over (2,4) — and the player does not
    // have to: the chain they are in has ended.
    expect(getCheckersLegalMoves(result.nextBoard, "black").length).toBeGreaterThan(0);
    expect(result.canJumpAgain).toBe(false);
  });

  it("never reports a chain on a move that captured nothing", () => {
    // `canJumpAgain` is a statement about captures. A quiet move that happens to
    // land a man from which a jump is available next turn is a finished move.
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    const result = applyCheckersMove(board, { from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }, "black");
    expect(result.canJumpAgain).toBe(false);
  });

  it("removes the captured piece even when jumpedCoord is omitted", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "white", type: "pawn" };
    const result = applyCheckersMove(board, { from: { x: 1, y: 1 }, to: { x: 3, y: 3 } }, "black");
    expect(result.nextBoard[2]![2]).toBeNull();
  });

  it("removes exactly one piece on every jump it is given", () => {
    // The rule under test, stated as a count rather than as a coordinate: a
    // jump captures one piece and no other, and the total on the board drops by
    // exactly one. Asserting on a single hand-built position only proves the
    // case someone thought of, so this sweeps every jump the generator offers
    // on the opening board and on a set of random-ish middlegame ones.
    const countPieces = (board: ReturnType<typeof emptyCheckers>): number =>
      board.flat().filter((cell) => cell !== null).length;

    const positions: ReturnType<typeof emptyCheckers>[] = [
      createInitialCheckersBoard(),
      // Middlegames built by *placing* jumps rather than by scattering pieces
      // at random: a mover, an adjacent enemy, and a clear landing square. A
      // random 8-piece board almost never contains a jump, which would make the
      // assertions below pass without ever running.
      ...Array.from({ length: 12 }, (_, n) => {
        const board = emptyCheckers();
        // A small deterministic LCG, masked back to 32 bits each step. The
        // obvious `seed * 1103515245` overflows a JS float, loses its integer
        // value, and yields NaN — which silently makes every generated
        // position empty.
        let seed = ((n + 1) * 2654435761) >>> 0;
        const next = (): number => {
          seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
          return seed;
        };
        // A few independent jump opportunities per board, so each position
        // exercises several captures rather than one.
        for (let i = 0; i < 3; i += 1) {
          const x = next() % (CHECKERS_SIZE - 2);
          const y = next() % (CHECKERS_SIZE - 2);
          const player = i % 2 === 0 ? "black" : "white";
          // Black moves toward y+1, white toward y-1.
          const dy = player === "black" ? 1 : -1;
          if (!isPlayableSquare(x, y)) continue;
          if (!isPlayableSquare(x + 1, y + dy) || !isPlayableSquare(x + 2, y + dy * 2)) continue;
          board[y]![x] = { color: player, type: i === 0 ? "king" : "pawn" };
          board[y + dy]![x + 1] = { color: player === "black" ? "white" : "black", type: "pawn" };
        }
        return board;
      }),
    ];

    let jumpsChecked = 0;
    for (const board of positions) {
      for (const player of ["black", "white"] as const) {
        for (const move of getCheckersLegalMoves(board, player)) {
          // Only jumps are in scope for this rule.
          if (!move.jumpedCoord) continue;
          const before = countPieces(board);
          const result = applyCheckersMove(board, move, player);
          expect(countPieces(result.nextBoard), `jump ${JSON.stringify(move)} by ${player}`).toBe(
            before - 1
          );
          // The captured square is empty, and nothing else changed.
          expect(result.nextBoard[move.jumpedCoord.y]![move.jumpedCoord.x]).toBeNull();
          expect(result.nextBoard[move.from.y]![move.from.x]).toBeNull();

          // The replay path — the one a reconnecting client takes, where the
          // wire sent only the two endpoints — must capture identically.
          const replayed = applyCheckersMove(
            board,
            { from: move.from, to: move.to },
            player
          );
          expect(replayed.nextBoard).toEqual(result.nextBoard);
          jumpsChecked += 1;
        }
      }
    }
    // Guard the guard: if the generator stopped producing jumps the assertions
    // above would pass vacuously.
    expect(jumpsChecked).toBeGreaterThan(20);
  });

  it("leaves the piece count alone on a quiet move", () => {
    const board = emptyCheckers();
    board[2]![1] = { color: "black", type: "pawn" };
    const move = getCheckersLegalMoves(board, "black").find((m) => !m.jumpedCoord);
    expect(move).toBeDefined();
    const result = applyCheckersMove(board, move!, "black");
    const countPieces = (b: ReturnType<typeof emptyCheckers>): number =>
      b.flat().filter((cell) => cell !== null).length;
    expect(countPieces(result.nextBoard)).toBe(countPieces(board));
  });

  it("moves men forward only and kings in all four directions", () => {
    const manBoard = emptyCheckers();
    manBoard[3]![0] = { color: "black", type: "pawn" };
    expect(getCheckersMovesFrom(manBoard, { x: 0, y: 3 }, "black").map((m) => m.to)).toEqual([
      { x: 1, y: 4 },
    ]);

    const backwardMan = emptyCheckers();
    backwardMan[3]![0] = { color: "white", type: "pawn" };
    expect(getCheckersMovesFrom(backwardMan, { x: 0, y: 3 }, "white").map((m) => m.to)).toEqual([
      { x: 1, y: 2 },
    ]);

    const kingBoard = emptyCheckers();
    kingBoard[4]![4] = { color: "black", type: "king" };
    expect(getCheckersMovesFrom(kingBoard, { x: 4, y: 4 }, "black")).toHaveLength(4);
  });

  it("crowns a black man that reaches the far rank", () => {
    const board = emptyCheckers();
    board[6]![2] = { color: "black", type: "pawn" };
    const result = applyCheckersMove(board, { from: { x: 2, y: 6 }, to: { x: 3, y: 7 } }, "black");
    expect(result.nextBoard[7]![3]).toEqual({ color: "black", type: "king" });
  });

  it("crowns a white man that reaches rank one", () => {
    const board = emptyCheckers();
    board[1]![2] = { color: "white", type: "pawn" };
    const result = applyCheckersMove(board, { from: { x: 2, y: 1 }, to: { x: 3, y: 0 } }, "white");
    expect(result.nextBoard[0]![3]).toEqual({ color: "white", type: "king" });
  });

  it("does not crown a man that only passes through the far rank", () => {
    const board = emptyCheckers();
    board[4]![2] = { color: "black", type: "pawn" };
    const result = applyCheckersMove(board, { from: { x: 2, y: 4 }, to: { x: 1, y: 5 } }, "black");
    expect(result.nextBoard[5]![1]).toEqual({ color: "black", type: "pawn" });
  });

  it("awards the game when the opponent has no legal move", () => {
    const board = emptyCheckers();
    setAt(board, 1, 0, { color: "black", type: "king" });
    setAt(board, 0, 7, { color: "white", type: "pawn" });
    // White's only step forward is blocked, and the square beyond the blocker
    // is occupied too, so the capture is unavailable as well.
    setAt(board, 1, 6, { color: "black", type: "pawn" });
    setAt(board, 2, 5, { color: "black", type: "pawn" });

    const result = applyCheckersMove(board, { from: { x: 1, y: 0 }, to: { x: 0, y: 1 } }, "black");
    expect(at(result.nextBoard, 1, 0)).toBeNull();
    expect(at(result.nextBoard, 0, 1)).toEqual({ color: "black", type: "king" });
    expect(getCheckersLegalMoves(result.nextBoard, "white")).toEqual([]);
    expect(result.winner).toBe("black");
    expect(result.isDraw).toBe(false);
  });

  it("ignores moves that originate on the opponent's pieces", () => {
    const board = createInitialCheckersBoard();
    expect(getCheckersMovesFrom(board, { x: 1, y: 0 }, "white")).toEqual([]);
  });

  it("rejects a move with no piece at the origin", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    expect(() => applyCheckersMove(board, { from: { x: 3, y: 3 }, to: { x: 4, y: 4 } }, "black")).toThrow(
      /piece selection/
    );
  });

  it("rejects a move that starts on the opponent's piece", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "white", type: "pawn" };
    expect(() => applyCheckersMove(board, { from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }, "black")).toThrow(
      /piece selection/
    );
  });

  it("rejects a move onto an occupied destination", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "black", type: "pawn" };
    expect(() => applyCheckersMove(board, { from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }, "black")).toThrow(
      /occupied/
    );
  });

  it("rejects a jump whose midpoint holds the mover's own piece", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "black", type: "pawn" };
    expect(() => applyCheckersMove(board, { from: { x: 1, y: 1 }, to: { x: 3, y: 3 } }, "black")).toThrow(
      /own piece/
    );
  });

  it("rejects a jump whose midpoint is empty", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    expect(() => applyCheckersMove(board, { from: { x: 1, y: 1 }, to: { x: 3, y: 3 } }, "black")).toThrow(
      /empty/
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Hex                                                                       */
/* -------------------------------------------------------------------------- */

describe("hex engine", () => {
  it("opens empty with all 49 cells playable", () => {
    const board = createInitialHexBoard();
    expect(board).toHaveLength(HEX_SIZE);
    expect(board.every((row) => row.length === HEX_SIZE && row.every((c) => c === null))).toBe(true);
    // A Hex move is a placement, so the legal set is every empty cell: 49 at
    // the start, and one fewer per stone already on the board.
    expect(getHexLegalMoves(board)).toHaveLength(HEX_SIZE * HEX_SIZE);
  });

  it("shrinks the legal set by exactly one per stone", () => {
    let board = createInitialHexBoard();
    for (let index = 0; index < 5; index += 1) {
      board = applyHexMove(board, { x: index, y: 0 }, index % 2 === 0 ? "black" : "white").nextBoard;
      expect(getHexLegalMoves(board)).toHaveLength(49 - index - 1);
    }
  });

  it("never offers an occupied cell", () => {
    const board = hexPosition([
      [0, 0, "black"],
      [3, 2, "white"],
      [6, 6, "black"],
    ]);
    const legal = new Set(getHexLegalMoves(board).map((c) => `${c.x},${c.y}`));
    expect(legal.has("0,0")).toBe(false);
    expect(legal.has("3,2")).toBe(false);
    expect(legal.has("6,6")).toBe(false);
    expect(legal).toHaveLength(49 - 3);
  });

  it("refuses a move onto an occupied or off-board cell", () => {
    const board = hexPosition([[2, 2, "black"]]);
    expect(() => applyHexMove(board, { x: 2, y: 2 }, "white")).toThrow(/already occupied/);
    expect(() => applyHexMove(board, { x: 7, y: 0 }, "black")).toThrow(/out of bounds/);
    expect(() => applyHexMove(board, { x: 0, y: -1 }, "black")).toThrow(/out of bounds/);
  });

  it("gives Black a win down a column across all seven rows", () => {
    const board = hexPosition([
      [3, 0, "black"],
      [3, 1, "black"],
      [3, 2, "black"],
      [3, 3, "black"],
      [3, 4, "black"],
      [3, 5, "black"],
      [3, 6, "black"],
    ]);
    expect(checkHexWin(board, "black")).toBe(true);
    // White holds nothing here, so its own span is untested by this position.
    expect(checkHexWin(board, "white")).toBe(false);
  });

  it("gives White a win across a row through all seven columns", () => {
    const triples: [number, number, "black" | "white"][] = [];
    for (let x = 0; x < HEX_SIZE; x += 1) triples.push([x, 4, "white"]);
    const board = hexPosition(triples);
    expect(checkHexWin(board, "white")).toBe(true);
    expect(checkHexWin(board, "black")).toBe(false);
  });

  it("does not award a win to a lone stone on a goal edge", () => {
    // The single most valuable false positive in this engine. The win is tested
    // when a stone is *dequeued* from the flood, not when it is discovered, so
    // a chain that starts on the goal edge still has to reach the far one.
    expect(checkHexWin(hexPosition([[4, 0, "black"]]), "black")).toBe(false);
    expect(checkHexWin(hexPosition([[0, 3, "white"]]), "white")).toBe(false);
  });

  it("does not award a win for a chain that misses one of the two goal edges", () => {
    // A column that stops one row short of the bottom.
    const triples: [number, number, "black" | "white"][] = [];
    for (let y = 0; y < HEX_SIZE - 1; y += 1) triples.push([2, y, "black"]);
    expect(checkHexWin(hexPosition(triples), "black")).toBe(false);
  });

  it("resolves the winner on the move that completes the chain", () => {
    // Six black stones with a single gap in the bottom row: nothing has been
    // won yet, and the position is genuinely one move from being over.
    const nearly = hexPosition([
      [4, 0, "black"],
      [4, 1, "black"],
      [4, 2, "black"],
      [4, 3, "black"],
      [4, 4, "black"],
      [4, 6, "black"],
    ]);
    expect(checkHexWin(nearly, "black")).toBe(false);

    const after = applyHexMove(nearly, { x: 4, y: 5 }, "black");
    expect(after.winner).toBe("black");
    expect(after.isDraw).toBe(false);
    // The same position, filled elsewhere, is still unfinished.
    expect(applyHexMove(nearly, { x: 0, y: 6 }, "white").winner).toBeNull();
  });

  it("joins chains along the diagonal, per the six directions", () => {
    // (6,0) -> (5,1) -> (4,2) -> (3,3) -> (2,4) -> (1,5) -> (0,6) is a
    // staircase: no two stones are orthogonally adjacent, and it is the
    // diagonal pair [-1,1] / [1,-1] that makes them neighbours at all. It runs
    // from the top edge to the bottom edge, so Black has won.
    const triples: [number, number, "black" | "white"][] = [];
    for (let step = 0; step < HEX_SIZE; step += 1) {
      triples.push([HEX_SIZE - 1 - step, step, "black"]);
    }
    expect(checkHexWin(hexPosition(triples), "black")).toBe(true);
  });

  it("treats the other diagonal as a gap, not a connection", () => {
    // The same staircase stepped the other way: (0,0) -> (1,1) is an offset of
    // (dy=1, dx=1), which is not in HEX_DIRECTIONS — each row is shifted left
    // of the one below it, not right — so these seven stones are seven
    // unrelated cells and nobody has connected anything.
    const board = hexPosition([
      [0, 0, "black"],
      [1, 1, "black"],
      [2, 2, "black"],
      [3, 3, "black"],
      [4, 4, "black"],
      [5, 5, "black"],
      [6, 6, "black"],
    ]);
    expect(checkHexWin(board, "black")).toBe(false);
  });

  it("does not join two chains through a stone of the other colour", () => {
    const board = hexPosition([
      [3, 0, "black"],
      [3, 1, "white"],
      [3, 2, "black"],
      [3, 3, "black"],
      [3, 4, "black"],
      [3, 5, "black"],
      [3, 6, "black"],
    ]);
    expect(checkHexWin(board, "black")).toBe(false);
  });

  it("states adjacency in exactly six directions, each with an opposite", () => {
    // The engine, the win check and the board view all read this one list. A
    // fifth or a seventh entry would change the game without changing the
    // board the player is looking at.
    expect(HEX_DIRECTIONS).toHaveLength(6);
    for (const [dy, dx] of HEX_DIRECTIONS) {
      expect([-1, 0, 1]).toContain(dy);
      expect([-1, 0, 1]).toContain(dx);
      expect(`${dy},${dx}`).not.toBe("0,0");
    }
    const keys = new Set(HEX_DIRECTIONS.map(([dy, dx]) => `${dy},${dx}`));
    for (const [dy, dx] of HEX_DIRECTIONS) {
      expect(keys.has(`${dy * -1},${dx * -1}`), `${dy},${dx} needs its opposite`).toBe(true);
    }
  });

  it("never mutates the board it was given", () => {
    const board = hexPosition([
      [1, 0, "black"],
      [1, 1, "white"],
    ]);
    const before = JSON.stringify(board);

    const result = applyHexMove(board, { x: 1, y: 2 }, "black");
    expect(JSON.stringify(board)).toBe(before);
    expect(at(result.nextBoard, 1, 2)).toBe("black");
    expect(at(result.nextBoard, 1, 1)).toBe("white");
    // The rows are new objects too, so a view still holding the old board
    // cannot be re-rendered into the new one by reference.
    expect(result.nextBoard).not.toBe(board);
    expect(result.nextBoard[0]).not.toBe(board[0]);
  });

  it("never reports a draw: the Hex theorem leaves no tie to reach", () => {
    const board = createInitialHexBoard();
    expect(applyHexMove(board, { x: 0, y: 0 }, "black").isDraw).toBe(false);
    expect(applyHexMove(board, { x: 6, y: 6 }, "black").isDraw).toBe(false);
    expect(applyHexMove(board, { x: 3, y: 3 }, "white").isDraw).toBe(false);
  });

  it("ends a played-out game with a winner, never a tie", () => {
    // Played to the end through the engine the app actually uses, so the
    // guarantee is on the product path and not only on the rules function: a
    // result dialog that can be handed `{ kind: "draw" }` for Hex is a dialog
    // showing a state the game cannot reach.
    const engine = getSessionEngine("hex");
    let board = engine.createInitialBoard();
    let player: PlayerColor = "black";

    for (let ply = 0; ply < HEX_SIZE * HEX_SIZE; ply += 1) {
      const legal = engine.getLegalSquares(board, player);
      if (legal.length === 0) break;
      const result = engine.applyMove(board, { to: legal[ply % legal.length]! }, player);
      expect(result.isDraw, "Hex has no draw").toBe(false);
      board = result.board;
      if (result.winner !== null) {
        expect(["black", "white"]).toContain(result.winner);
        return;
      }
      player = player === "black" ? "white" : "black";
    }

    // A full board with no winner would be a tie, which Hex forbids. Failing
    // here means the board filled up without connecting anything, which is a
    // real state the win check would have to be able to explain.
    expect.fail("a full Hex board must resolve to a winner");
  });
});

/* -------------------------------------------------------------------------- */
/* Cross-engine invariants                                                   */
/* -------------------------------------------------------------------------- */

describe("cross-engine invariants", () => {
  it("hands out a fresh board on every initialisation", () => {
    const initialisers = [
      createInitialTicTacToeBoard,
      createInitialConnect4Board,
      createInitialGomokuBoard,
      createInitialReversiBoard,
      createInitialCheckersBoard,
      createInitialHexBoard,
    ] as const;

    for (const initialise of initialisers) {
      const first = initialise();
      const snapshot = JSON.stringify(first);
      const second = initialise();
      expect(JSON.stringify(first)).toBe(snapshot);
      expect(second).not.toBe(first);
    }
  });
});
