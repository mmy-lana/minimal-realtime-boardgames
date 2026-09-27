import { describe, expect, it } from "vitest";
import {
  applyTicTacToeMove,
  createInitialTicTacToeBoard,
  findTicTacToeWinningLine,
  getTicTacToeLegalMoves,
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
  applyChessMove,
  createInitialChessBoard,
  getChessRawMoves,
  getChessSelectableSquares,
} from "@/engine/rules/chess";
import type {
  CheckersBoard,
  ChessBoard,
  ChessPiece,
  Connect4Board,
  Coordinates,
  GomokuBoard,
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

/** An empty Chess board. */
function emptyChess(): ChessBoard {
  return Array.from({ length: 8 }, () => Array<ChessPiece | null>(8).fill(null));
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

  it("declares a draw only when the last cell fills a line-free board", () => {
    // b w b / b w w / w b _ — no three in a row once black takes the last cell.
    const board = playTicTacToe([
      [0, 0, "black"],
      [1, 0, "white"],
      [2, 0, "black"],
      [0, 1, "black"],
      [1, 1, "white"],
      [2, 1, "white"],
      [0, 2, "white"],
      [1, 2, "black"],
    ]);
    expect(board.filter((cell) => cell !== null)).toHaveLength(8);

    const drawn = applyTicTacToeMove(board, tictactoeIndexOf({ x: 2, y: 2 }), "black");
    expect(drawn.winner).toBeNull();
    expect(drawn.isDraw).toBe(true);
    expect(drawn.nextBoard.filter((cell) => cell !== null)).toHaveLength(9);
  });

  it("does not call a full board a draw when a line completes on the last cell", () => {
    // b b _ / b w b / w b w — black takes the top-right cell to close row one.
    const board = playTicTacToe([
      [0, 0, "black"],
      [1, 0, "black"],
      [0, 1, "black"],
      [1, 1, "white"],
      [2, 1, "black"],
      [0, 2, "white"],
      [1, 2, "black"],
      [2, 2, "white"],
    ]);
    expect(board.filter((cell) => cell !== null)).toHaveLength(8);
    expect(findTicTacToeWinningLine(board, 0)).toBeNull();

    const result = applyTicTacToeMove(board, tictactoeIndexOf({ x: 2, y: 0 }), "black");
    expect(result.nextBoard.filter((cell) => cell !== null)).toHaveLength(9);
    expect(result.winner).toBe("black");
    expect(result.isDraw).toBe(false);
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

  it("removes the captured piece even when jumpedCoord is omitted", () => {
    const board = emptyCheckers();
    board[1]![1] = { color: "black", type: "pawn" };
    board[2]![2] = { color: "white", type: "pawn" };
    const result = applyCheckersMove(board, { from: { x: 1, y: 1 }, to: { x: 3, y: 3 } }, "black");
    expect(result.nextBoard[2]![2]).toBeNull();
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
/* Chess                                                                     */
/* -------------------------------------------------------------------------- */

describe("chess engine", () => {
  it("opens with the standard back ranks and eight pawns per side", () => {
    const board = createInitialChessBoard();
    expect(board[0]?.[0]).toEqual({ color: "black", type: "r", hasMoved: false });
    expect(board[0]?.[4]).toEqual({ color: "black", type: "k", hasMoved: false });
    expect(board[7]?.[4]).toEqual({ color: "white", type: "k", hasMoved: false });
    expect(board[1]?.every((c) => c?.type === "p" && c.color === "black")).toBe(true);
    expect(board[6]?.every((c) => c?.type === "p" && c.color === "white")).toBe(true);
  });

  it("gives a starting pawn one or two squares and no empty diagonal", () => {
    const board = createInitialChessBoard();
    expect(getChessRawMoves(board, { x: 4, y: 1 }, "black")).toEqual([
      { x: 4, y: 2 },
      { x: 4, y: 3 },
    ]);
  });

  it("blocks a pawn's double step when the path is occupied", () => {
    const board = createInitialChessBoard();
    board[2]![4] = { color: "black", type: "p", hasMoved: false };
    expect(getChessRawMoves(board, { x: 4, y: 1 }, "black")).toEqual([]);
  });

  it("gives a moved pawn only the single step", () => {
    const board = emptyChess();
    setAt(board, 4, 3, { color: "black", type: "p", hasMoved: true });
    // Black advances towards row 7 in this engine's coordinate space.
    expect(getChessRawMoves(board, { x: 4, y: 3 }, "black")).toEqual([{ x: 4, y: 4 }]);
  });

  it("gives white's pawns the mirrored direction", () => {
    const board = emptyChess();
    setAt(board, 4, 5, { color: "white", type: "p", hasMoved: true });
    expect(getChessRawMoves(board, { x: 4, y: 5 }, "white")).toEqual([{ x: 4, y: 4 }]);
  });

  it("captures diagonally only onto an enemy piece", () => {
    const board = emptyChess();
    board[1]![4] = { color: "black", type: "p", hasMoved: false };
    board[2]![3] = { color: "white", type: "p", hasMoved: true };
    board[2]![5] = { color: "black", type: "p", hasMoved: true };

    const targets = getChessRawMoves(board, { x: 4, y: 1 }, "black");
    expect(targets).toContainEqual({ x: 3, y: 2 });
    expect(targets).not.toContainEqual({ x: 5, y: 2 });
  });

  it("moves a knight to all eight offsets when unblocked", () => {
    const board = emptyChess();
    board[3]![3] = { color: "black", type: "n" };
    expect(getChessRawMoves(board, { x: 3, y: 3 }, "black")).toHaveLength(8);
  });

  it("stops a knight at the board edge", () => {
    const board = emptyChess();
    board[0]![0] = { color: "black", type: "n" };
    expect(getChessRawMoves(board, { x: 0, y: 0 }, "black")).toHaveLength(2);
  });

  it("slides a rook orthogonally and blocks at the first piece", () => {
    const board = emptyChess();
    board[3]![3] = { color: "black", type: "r" };
    board[3]![6] = { color: "white", type: "p", hasMoved: true };

    const targets = getChessRawMoves(board, { x: 3, y: 3 }, "black");
    expect(targets).toContainEqual({ x: 0, y: 3 });
    expect(targets).toContainEqual({ x: 6, y: 3 });
    expect(targets).not.toContainEqual({ x: 7, y: 3 });
    expect(targets.every((t) => t.x === 3 || t.y === 3)).toBe(true);
  });

  it("slides a bishop on diagonals only", () => {
    const board = emptyChess();
    board[3]![3] = { color: "black", type: "b" };
    const targets = getChessRawMoves(board, { x: 3, y: 3 }, "black");
    // 4 + 3 + 3 + 3 from the centre of an empty board.
    expect(targets).toHaveLength(13);
    expect(targets.every((t) => Math.abs(t.x - 3) === Math.abs(t.y - 3))).toBe(true);
  });

  it("moves a queen on both axes and diagonals", () => {
    const board = emptyChess();
    board[3]![3] = { color: "black", type: "q" };
    const targets = getChessRawMoves(board, { x: 3, y: 3 }, "black");
    expect(targets).toHaveLength(14 + 13);
  });

  it("moves a king one square in eight directions", () => {
    const board = emptyChess();
    board[3]![3] = { color: "black", type: "k" };
    expect(getChessRawMoves(board, { x: 3, y: 3 }, "black")).toHaveLength(8);
  });

  it("refuses to move an opponent's piece or an empty square", () => {
    const board = createInitialChessBoard();
    expect(getChessRawMoves(board, { x: 4, y: 1 }, "white")).toEqual([]);
    expect(getChessRawMoves(board, { x: 3, y: 3 }, "black")).toEqual([]);
  });

  it("marks the moved piece and clears the origin without mutating the input", () => {
    const board = createInitialChessBoard();
    const result = applyChessMove(board, { x: 4, y: 1 }, { x: 4, y: 3 }, "black");
    expect(result.nextBoard[1]![4]).toBeNull();
    expect(result.nextBoard[3]![4]).toEqual({ color: "black", type: "p", hasMoved: true });
    expect(board[1]![4]).not.toBeNull();
  });

  it("removes a captured piece", () => {
    const board = emptyChess();
    setAt(board, 4, 1, { color: "black", type: "p", hasMoved: false });
    setAt(board, 5, 2, { color: "white", type: "p", hasMoved: true });
    const countPieces = (b: ChessBoard): number =>
      b.reduce((total, row) => total + row.filter((c) => c !== null).length, 0);

    const result = applyChessMove(board, { x: 4, y: 1 }, { x: 5, y: 2 }, "black");
    // The destination holds the mover's pawn; the defender is gone.
    expect(at(result.nextBoard, 5, 2)).toEqual({ color: "black", type: "p", hasMoved: true });
    expect(at(result.nextBoard, 4, 1)).toBeNull();
    expect(countPieces(result.nextBoard)).toBe(1);
  });

  it("ends the game when the king is captured", () => {
    const board = emptyChess();
    board[3]![3] = { color: "black", type: "r" };
    board[3]![5] = { color: "white", type: "k" };

    const result = applyChessMove(board, { x: 3, y: 3 }, { x: 5, y: 3 }, "black");
    expect(result.winner).toBe("black");
    expect(result.isDraw).toBe(false);
  });

  it("leaves the winner unset when the opponent king survives", () => {
    const board = emptyChess();
    board[1]![4] = { color: "black", type: "p", hasMoved: false };
    board[7]![4] = { color: "white", type: "k" };
    const result = applyChessMove(board, { x: 4, y: 1 }, { x: 4, y: 2 }, "black");
    expect(result.winner).toBeNull();
    expect(result.isDraw).toBe(false);
  });

  it("rejects a move outside the pseudo-legal set", () => {
    const board = createInitialChessBoard();
    expect(() => applyChessMove(board, { x: 4, y: 1 }, { x: 7, y: 1 }, "black")).toThrow(
      /Invalid chess move/
    );
  });

  it("rejects a pawn stepping sideways", () => {
    const board = emptyChess();
    board[1]![4] = { color: "black", type: "p", hasMoved: false };
    expect(() => applyChessMove(board, { x: 4, y: 1 }, { x: 5, y: 2 }, "black")).toThrow(
      /Invalid chess move/
    );
  });

  it("lists only own pieces that still have a move", () => {
    const board = createInitialChessBoard();
    const selectable = getChessSelectableSquares(board, "black");
    // The two rooks, two bishops and the queen are hemmed in by their own
    // pawns; the eight pawns and both knights can move.
    expect(selectable).toHaveLength(10);
    expect(selectable.every((c) => board[c.y]?.[c.x]?.color === "black")).toBe(true);
  });

  it("never reports a draw, matching the micro-engine's scope", () => {
    // The plan scopes chess to movement only: no insufficient-material rule and
    // no fifty-move counter, so `isDraw` is structurally always false.
    const opening = applyChessMove(
      createInitialChessBoard(),
      { x: 4, y: 1 },
      { x: 4, y: 3 },
      "black"
    );
    expect(opening.isDraw).toBe(false);
    expect(opening.winner).toBeNull();
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
      createInitialChessBoard,
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
