/**
 * Section 2.1 — Unified game engine factory.
 *
 * The six rule engines are pure and idiomatic in their own terms, but they
 * disagree about how a move is addressed: Tic-Tac-Toe takes a flat index,
 * Connect Four a column, Gomoku and Reversi a coordinate, Checkers and Chess a
 * from/to pair. Every layer above the engines — the session hook, the board
 * views, the history timeline, and the reconnect replay — would otherwise have
 * to branch on `gameKind`.
 *
 * This module erases that difference behind one interface. A single
 * {@link NormalizedMove} shape is the only move representation that ever
 * reaches IndexedDB or the `game_moves` table, and it is lossless:
 *
 * | Game        | `from`            | `to`                       |
 * |-------------|-------------------|----------------------------|
 * | tictactoe   | —                 | target cell                |
 * | connect4    | —                 | target column              |
 * | gomoku      | —                 | intersection               |
 * | reversi     | —                 | intersection               |
 * | checkers    | origin square     | destination (jump implied) |
 * | hex         | —                 | target cell                |
 *
 * Checkers' `jumpedCoord` is not stored because it is fully derivable from the
 * endpoints via `deriveJumpedCoord` — which is exactly what Section 4.4
 * requires a reconnecting client to do.
 *
 * No `as` casts are used: each implementation narrows its `UniversalBoard`
 * parameter through the checked `assertBoardSnapshot`, so a kind mismatch
 * fails loudly at the boundary instead of corrupting a board.
 */

import type {
  Coordinates,
  GameKind,
  PlayerColor,
  UniversalBoard,
} from "@/engine/types";
import { assertBoardSnapshot, opponentOf } from "@/engine/types";
import { formatGridSquare, formatSquare } from "@/lib/utils";

import {
  applyTicTacToeMove,
  createInitialTicTacToeBoard,
  getTicTacToeLegalMoves,
  tictactoeIndexOf,
  TICTACTOE_SIZE,
} from "./rules/tictactoe";
import {
  applyConnect4Move,
  createInitialConnect4Board,
  getConnect4LegalMoves,
} from "./rules/connect4";
import {
  applyGomokuMove,
  createInitialGomokuBoard,
  getGomokuLegalMoves,
  GOMOKU_SIZE,
} from "./rules/gomoku";
import {
  applyReversiMove,
  createInitialReversiBoard,
  getValidReversiMoves,
  REVERSI_SIZE,
} from "./rules/reversi";
import {
  applyCheckersMove,
  CHECKERS_SIZE,
  createInitialCheckersBoard,
  deriveJumpedCoord,
  getCheckersLegalMoves,
  getCheckersMovesFrom,
} from "./rules/checkers";
import {
  applyHexMove,
  createInitialHexBoard,
  getHexLegalMoves,
  HEX_SIZE,
} from "./rules/hex";

/**
 * The single move representation persisted in `MoveRecord` and in the
 * `game_moves` table.
 */
export interface NormalizedMove {
  /** Origin square. Always present for movement games, absent for placement games. */
  from?: Coordinates;
  /** Destination square, or the played cell/column for placement games. */
  to: Coordinates;
}

export interface EngineMoveResult {
  /** The new board, tagged with the same `kind` as the input. */
  board: UniversalBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
  /**
   * `true` when the mover keeps the turn because the opponent has no legal
   * reply. Only Reversi can produce this, and the fact is recorded in the
   * move's payload so a replay reproduces it.
   */
  passesTurn: boolean;
}

/**
 * Uniform contract implemented by all six games.
 *
 * Board arguments are the tagged {@link UniversalBoard} union rather than a
 * generic `BoardStateFor<K>`: the session hook holds a session whose kind is
 * only known at runtime, and the discriminated union lets each implementation
 * narrow with a checked assertion instead of an unchecked cast.
 */
export interface SessionEngine {
  readonly kind: GameKind;

  /** A fresh starting position for this game. */
  createInitialBoard(): UniversalBoard;

  /**
   * Squares the player may move *from*. Non-empty only for movement games
   * (Checkers); a tap on one of these starts a selection.
   */
  getSelectableSquares(board: UniversalBoard, player: PlayerColor): readonly Coordinates[];

  /**
   * Squares the player may play on right now. For placement games this is the
   * whole legal move set; for movement games it is empty until a square is
   * selected, because destinations depend on the chosen piece.
   */
  getLegalSquares(board: UniversalBoard, player: PlayerColor): readonly Coordinates[];

  /** Destinations available after the player selects `from`. */
  getDestinations(
    board: UniversalBoard,
    from: Coordinates,
    player: PlayerColor
  ): readonly Coordinates[];

  /** Applies a normalized move. Throws when the move is illegal. */
  applyMove(
    board: UniversalBoard,
    move: NormalizedMove,
    player: PlayerColor
  ): EngineMoveResult;

  /** Human-readable label for a move, used by the history timeline. */
  formatMove(move: NormalizedMove): string;

  /** Human-readable label for a single square, used for `aria-label`s. */
  formatSquare(coord: Coordinates): string;

  /** `true` when moves in this game carry an origin square. */
  readonly usesOriginSquare: boolean;
}

const ticTacToeEngine: SessionEngine = {
  kind: "tictactoe",
  usesOriginSquare: false,

  createInitialBoard: () => ({ kind: "tictactoe", state: createInitialTicTacToeBoard() }),

  getSelectableSquares: () => [],

  getLegalSquares: (board) => getTicTacToeLegalMoves(assertBoardSnapshot(board, "tictactoe").state),

  getDestinations: () => [],

  applyMove: (board, move, player) => {
    const state = assertBoardSnapshot(board, "tictactoe").state;
    const result = applyTicTacToeMove(state, tictactoeIndexOf(move.to), player);
    return {
      board: { kind: "tictactoe", state: result.nextBoard },
      winner: result.winner,
      isDraw: result.isDraw,
      passesTurn: false,
    };
  },

  formatMove: (move) => formatGridSquare(move.to.x, move.to.y, TICTACTOE_SIZE),
  formatSquare: (coord) => formatGridSquare(coord.x, coord.y, TICTACTOE_SIZE),
};

const connectFourEngine: SessionEngine = {
  kind: "connect4",
  usesOriginSquare: false,

  createInitialBoard: () => ({ kind: "connect4", state: createInitialConnect4Board() }),

  getSelectableSquares: () => [],

  getLegalSquares: (board) => getConnect4LegalMoves(assertBoardSnapshot(board, "connect4").state),

  getDestinations: () => [],

  applyMove: (board, move, player) => {
    const state = assertBoardSnapshot(board, "connect4").state;
    const col = move.to.x;
    const result = applyConnect4Move(state, col, player);
    return {
      board: { kind: "connect4", state: result.nextBoard },
      winner: result.winner,
      isDraw: result.isDraw,
      passesTurn: false,
    };
  },

  // A Connect Four move is a column, and its landing row is a function of the
  // board rather than of the move, so the column is what gets recorded.
  formatMove: (move) => `Col ${move.to.x + 1}`,
  formatSquare: (coord) => `Column ${coord.x + 1}`,
};

const gomokuEngine: SessionEngine = {
  kind: "gomoku",
  usesOriginSquare: false,

  createInitialBoard: () => ({ kind: "gomoku", state: createInitialGomokuBoard() }),

  getSelectableSquares: () => [],

  getLegalSquares: (board) => getGomokuLegalMoves(assertBoardSnapshot(board, "gomoku").state),

  getDestinations: () => [],

  applyMove: (board, move, player) => {
    const state = assertBoardSnapshot(board, "gomoku").state;
    const result = applyGomokuMove(state, move.to, player);
    return {
      board: { kind: "gomoku", state: result.nextBoard },
      winner: result.winner,
      isDraw: result.isDraw,
      passesTurn: false,
    };
  },

  formatMove: (move) => formatGridSquare(move.to.x, move.to.y, GOMOKU_SIZE),
  formatSquare: (coord) => formatGridSquare(coord.x, coord.y, GOMOKU_SIZE),
};

const reversiEngine: SessionEngine = {
  kind: "reversi",
  usesOriginSquare: false,

  createInitialBoard: () => ({ kind: "reversi", state: createInitialReversiBoard() }),

  getSelectableSquares: () => [],

  getLegalSquares: (board, player) =>
    getValidReversiMoves(assertBoardSnapshot(board, "reversi").state, player),

  getDestinations: () => [],

  applyMove: (board, move, player) => {
    const state = assertBoardSnapshot(board, "reversi").state;
    const result = applyReversiMove(state, move.to, player);
    return {
      board: { kind: "reversi", state: result.nextBoard },
      winner: result.winner,
      isDraw: result.isDraw,
      // The engine reports whether the *opponent* can reply; a `false` here
      // means the mover plays again.
      passesTurn: !result.nextTurnHasValidMoves,
    };
  },

  formatMove: (move) => formatGridSquare(move.to.x, move.to.y, REVERSI_SIZE),
  formatSquare: (coord) => formatGridSquare(coord.x, coord.y, REVERSI_SIZE),
};

const checkersEngine: SessionEngine = {
  kind: "checkers",
  usesOriginSquare: true,

  createInitialBoard: () => ({ kind: "checkers", state: createInitialCheckersBoard() }),

  getSelectableSquares: (board, player) => {
    const state = assertBoardSnapshot(board, "checkers").state;
    const seen = new Map<string, Coordinates>();
    for (const move of getCheckersLegalMoves(state, player)) {
      seen.set(`${move.from.x},${move.from.y}`, move.from);
    }
    return [...seen.values()];
  },

  getLegalSquares: () => [],

  getDestinations: (board, from, player) => {
    const state = assertBoardSnapshot(board, "checkers").state;
    return getCheckersMovesFrom(state, from, player).map((move) => move.to);
  },

  applyMove: (board, move, player) => {
    const state = assertBoardSnapshot(board, "checkers").state;
    if (!move.from) {
      throw new Error("Invalid checkers move: an origin square is required");
    }
    const result = applyCheckersMove(
      state,
      {
        from: move.from,
        to: move.to,
        // Re-derived, never taken from the wire, so a replayed move is
        // identical to a locally dispatched one.
        jumpedCoord: deriveJumpedCoord(move.from, move.to),
      },
      player
    );
    return {
      board: { kind: "checkers", state: result.nextBoard },
      winner: result.winner,
      isDraw: result.isDraw,
      passesTurn: false,
    };
  },

  formatMove: (move) =>
    move.from
      ? `${formatGridSquare(move.from.x, move.from.y, CHECKERS_SIZE)}-${formatGridSquare(
          move.to.x,
          move.to.y,
          CHECKERS_SIZE
        )}`
      : formatGridSquare(move.to.x, move.to.y, CHECKERS_SIZE),
  formatSquare: (coord) => formatGridSquare(coord.x, coord.y, CHECKERS_SIZE),
};

const hexEngine: SessionEngine = {
  kind: "hex",
  usesOriginSquare: false,

  createInitialBoard: () => ({ kind: "hex", state: createInitialHexBoard() }),

  // A Hex move has no origin: tapping any empty cell is the whole move, so the
  // legal set is reported directly and there is nothing to select first. This is
  // what makes every empty cell a valid target ring on the board view.
  getSelectableSquares: () => [],

  getLegalSquares: (board) => getHexLegalMoves(assertBoardSnapshot(board, "hex").state),

  getDestinations: () => [],

  applyMove: (board, move, player) => {
    const state = assertBoardSnapshot(board, "hex").state;
    const result = applyHexMove(state, move.to, player);
    return {
      board: { kind: "hex", state: result.nextBoard },
      winner: result.winner,
      // Hex is decided by the Hex theorem, so a room can never reach a tie and
      // the status ladder below never has to represent one for this kind.
      isDraw: result.isDraw,
      passesTurn: false,
    };
  },

  // `formatGridSquare` gives Hex its conventional notation directly: files
  // `A`..`G` across, rows `1`..`7` down, so D4 reads exactly as it does on a
  // printed board.
  formatMove: (move) => formatGridSquare(move.to.x, move.to.y, HEX_SIZE),
  formatSquare: (coord) => formatGridSquare(coord.x, coord.y, HEX_SIZE),
};

/** Every engine, keyed by kind. Insertion order is irrelevant; lookups are. */
export const SESSION_ENGINES: Readonly<Record<GameKind, SessionEngine>> = {
  tictactoe: ticTacToeEngine,
  connect4: connectFourEngine,
  gomoku: gomokuEngine,
  reversi: reversiEngine,
  checkers: checkersEngine,
  hex: hexEngine,
};

export function getSessionEngine(kind: GameKind): SessionEngine {
  const engine = SESSION_ENGINES[kind];
  // A silently undefined engine would surface later as an unrelated crash
  // inside a rule file, so an unknown kind fails here, where the caller is.
  if (!engine) {
    throw new Error(`No rule engine is registered for game kind "${String(kind)}"`);
  }
  return engine;
}

/**
 * Replays an ordered move log onto `board`, applying each entry through its own
 * engine.
 *
 * This is the core of Section 4.4's integrity gate. It is deliberately strict:
 * an entry that the engine rejects, or a turn hand-off that does not line up
 * with the recorded mover, produces a failure rather than a silently repaired
 * board, because either situation means the client's view has already diverged
 * from the authoritative log.
 */
export function replayMoves(
  board: UniversalBoard,
  moves: readonly { player: PlayerColor; from?: Coordinates; to: Coordinates }[],
  options: { passesTurn?: (index: number) => boolean } = {}
): { board: UniversalBoard; winner: PlayerColor | null; isDraw: boolean } {
  const engine = getSessionEngine(board.kind);
  let current = board;
  let expectedPlayer: PlayerColor = "black";
  let winner: PlayerColor | null = null;
  let isDraw = false;

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];

    if (winner !== null || isDraw) {
      throw new Error(
        `Replay halted at ply ${index + 1}: the game already ended before this move`
      );
    }
    if (move.player !== expectedPlayer) {
      throw new Error(
        `Replay halted at ply ${index + 1}: expected ${expectedPlayer} to move, found ${move.player}`
      );
    }

    let result: EngineMoveResult;
    try {
      result = engine.applyMove(current, { from: move.from, to: move.to }, move.player);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Replay halted at ply ${index + 1}: ${engine.kind} rejected the move — ${reason}`
      );
    }

    current = result.board;
    winner = result.winner;
    isDraw = result.isDraw;

    const passes = options.passesTurn?.(index) ?? result.passesTurn;
    if (passes) {
      // A Reversi pass leaves the mover on the move; the next ply must still be
      // theirs, so `expectedPlayer` is deliberately unchanged.
      continue;
    }
    expectedPlayer = opponentOf(move.player);
  }

  return { board: current, winner, isDraw };
}
