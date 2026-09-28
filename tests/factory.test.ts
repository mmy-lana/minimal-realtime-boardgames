import { describe, expect, it } from "vitest";

import {
  boardStatesEqual,
  canLocalPlayerAct,
  coordinatesEqual,
  decodeMovePayload,
  encodeMovePayload,
  getBoardCell,
  isCoordinates,
  setBoardCell,
  matchStatusFromResult,
  opponentOf,
  winnerFromStatus,
  type Connect4Board,
  type Coordinates,
  type GameSession,
  type MoveRecord,
  type PlayerColor,
  type ReversiBoard,
  type UniversalBoard,
} from "@/engine/types";
import { SESSION_ENGINES, getSessionEngine, replayMoves } from "@/engine/factory";
import { createGameSession, verifyHistory } from "@/hooks/useGameSession";

function sessionFor(gameKind: GameSession["gameKind"]): GameSession {
  return createGameSession({
    gameKind,
    mode: "offline_local",
    playerBlackToken: "black-token",
    localSeat: "black",
  });
}

describe("move payload encoding", () => {
  it("round-trips notation and the pass flag", () => {
    const payload = encodeMovePayload({ notation: "e2-e4", passesTurn: true });
    expect(decodeMovePayload(payload)).toEqual({ notation: "e2-e4", passesTurn: true });
  });

  it("round-trips a payload with no pass flag", () => {
    const payload = encodeMovePayload({ notation: "H8", passesTurn: false });
    expect(decodeMovePayload(payload)).toEqual({ notation: "H8", passesTurn: false });
  });

  it("keeps the notation readable so a log entry stays human-facing", () => {
    expect(encodeMovePayload({ notation: "e2-e4", passesTurn: false })).toBe("e2-e4");
    expect(encodeMovePayload({ notation: "e2-e4", passesTurn: true })).toBe("e2-e4|pass");
  });

  it("treats a payload with no pass suffix as not passing the turn", () => {
    expect(decodeMovePayload("a1-a2")).toEqual({ notation: "a1-a2", passesTurn: false });
  });

  it("survives an empty notation rather than producing a malformed marker", () => {
    const decoded = decodeMovePayload(encodeMovePayload({ notation: "", passesTurn: true }));
    expect(decoded.notation).toBe("");
    expect(decoded.passesTurn).toBe(true);
  });
});

describe("board helpers", () => {
  // `getBoardCell` addresses the cell grid itself, not the board wrapper, so
  // the fixtures take `.state`. Connect Four is the two-dimensional case; the
  // flat-array games (Tic-Tac-Toe, Reversi) have their own accessors.
  const cellGrid = (): Connect4Board =>
    getSessionEngine("connect4").createInitialBoard().state as Connect4Board;

  it("reads board[y][x] through getBoardCell", () => {
    const grid = cellGrid();
    setBoardCell(grid, 0, 1, "black");
    expect(getBoardCell(grid, 0, 1)).toBe("black");
    expect(getBoardCell(grid, 1, 0)).toBeNull();
  });

  it("returns null for coordinates outside the board instead of throwing", () => {
    const grid = cellGrid();
    expect(getBoardCell(grid, -1, 0)).toBeNull();
    expect(getBoardCell(grid, 0, 999)).toBeNull();
  });

  it("returns a fresh grid each time, so two sessions cannot alias", () => {
    const first = cellGrid();
    const second = cellGrid();
    setBoardCell(first, 0, 0, "black");
    expect(getBoardCell(second, 0, 0)).toBeNull();
  });

  it("reports two identical boards as equal", () => {
    expect(
      boardStatesEqual(
        getSessionEngine("connect4").createInitialBoard(),
        getSessionEngine("connect4").createInitialBoard()
      )
    ).toBe(true);
  });

  it("reports a single changed cell as different", () => {
    const changed = cellGrid();
    setBoardCell(changed, 3, 4, "white");
    expect(
      boardStatesEqual(getSessionEngine("connect4").createInitialBoard(), { kind: "connect4", state: changed })
    ).toBe(false);
  });

  it("treats two different kinds as different even with equal grids", () => {
    expect(
      boardStatesEqual(
        getSessionEngine("tictactoe").createInitialBoard(),
        getSessionEngine("tictactoe").createInitialBoard()
      )
    ).toBe(true);
    expect(
      boardStatesEqual(
        getSessionEngine("tictactoe").createInitialBoard(),
        getSessionEngine("reversi").createInitialBoard()
      )
    ).toBe(false);
  });

  it("compares coordinates by value", () => {
    expect(coordinatesEqual({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(true);
    expect(coordinatesEqual({ x: 2, y: 3 }, { x: 3, y: 2 })).toBe(false);
  });

  it("validates coordinate shape", () => {
    expect(isCoordinates({ x: 0, y: 0 })).toBe(true);
    expect(isCoordinates({ x: -1, y: 0 })).toBe(false);
    expect(isCoordinates({ x: 0 })).toBe(false);
    expect(isCoordinates(null)).toBe(false);
  });
});

describe("status and seat helpers", () => {
  it("maps a win to the winning seat's status", () => {
    expect(matchStatusFromResult("white", false)).toBe("won_white");
    expect(winnerFromStatus("won_white")).toBe("white");
  });

  it("maps a draw to a draw regardless of the passed winner", () => {
    expect(matchStatusFromResult("black", true)).toBe("draw");
    expect(winnerFromStatus("draw")).toBeNull();
  });

  it("leaves an active match active when there is no result", () => {
    expect(matchStatusFromResult(null, false, "active")).toBe("active");
    expect(winnerFromStatus("active")).toBeNull();
  });

  it("names the opposite seat", () => {
    expect(opponentOf("black")).toBe("white");
    expect(opponentOf("white")).toBe("black");
  });

  it("only lets the seat whose turn it is act in a realtime match", () => {
    const session = {
      ...sessionFor("hex"),
      mode: "online_realtime" as const,
      currentTurn: "black" as PlayerColor,
    };
    expect(canLocalPlayerAct(session, "black")).toBe(true);
    expect(canLocalPlayerAct(session, "white")).toBe(false);
  });

  it("lets either colour act in a local match, because both share the device", () => {
    const session = { ...sessionFor("hex"), currentTurn: "white" as PlayerColor };
    expect(session.mode).toBe("offline_local");
    expect(canLocalPlayerAct(session, "black")).toBe(true);
  });

  it("refuses a read-only observer that holds no seat", () => {
    expect(canLocalPlayerAct(sessionFor("hex"), null)).toBe(false);
  });

  it("refuses any seat once the match is finished", () => {
    const session = { ...sessionFor("hex"), status: "draw" as const };
    expect(canLocalPlayerAct(session, "black")).toBe(false);
  });

  it("refuses every seat once the session has a sync conflict", () => {
    const session = { ...sessionFor("hex"), syncState: "conflict" as const };
    expect(canLocalPlayerAct(session, "black")).toBe(false);
    expect(canLocalPlayerAct(session, "white")).toBe(false);
  });
});

describe("verifyHistory", () => {
  it("accepts a freshly created session", () => {
    const result = verifyHistory(sessionFor("tictactoe"));
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("rebuilds the same board a history claims", () => {
    const session = sessionFor("tictactoe");
    const engine = getSessionEngine("tictactoe");
    session.history = [
      { id: "m1", gameId: session.id, ply: 1, player: "black", to: { x: 0, y: 0 }, timestamp: 1 },
      { id: "m2", gameId: session.id, ply: 2, player: "white", to: { x: 1, y: 1 }, timestamp: 2 },
    ];
    session.boardSnapshot = engine.applyMove(session.boardSnapshot, { to: { x: 0, y: 0 } }, "black").board;
    session.boardSnapshot = engine.applyMove(session.boardSnapshot, { to: { x: 1, y: 1 } }, "white").board;
    const result = verifyHistory(session);
    expect(result.ok).toBe(true);
  });

  it("accepts a line long enough to have lifted marks off the board", () => {
    // Seven plies, so both sides have passed three marks and each has lost one.
    // This is the first length of game at which the mark that vanishes is
    // decided by the move log rather than by the board — and therefore the first
    // length at which live play and the integrity gate can disagree if either
    // side stops threading the log. A gate that flagged a normal mid-game
    // session as corrupt would make the game unplayable, so this is asserted
    // rather than assumed.
    const session = sessionFor("tictactoe");
    const engine = getSessionEngine("tictactoe");
    const to: Coordinates[] = [
      { x: 2, y: 2 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ];

    const history: { player: PlayerColor; to: Coordinates }[] = [];
    let board = session.boardSnapshot;
    to.forEach((coord, index) => {
      const player: PlayerColor = index % 2 === 0 ? "black" : "white";
      board = engine.applyMove(
        board,
        { to: coord },
        player,
        { history: history.filter((entry) => entry.player === player) }
      ).board;
      history.push({ player, to: coord });
    });

    session.history = history.map((entry, index) => ({
      id: `m${index + 1}`,
      gameId: session.id,
      ply: index + 1,
      player: entry.player,
      to: entry.to,
      timestamp: index + 1,
    }));
    session.boardSnapshot = board;

    // Marks really were lifted, so the fixture is testing what it claims to.
    const state = board.kind === "tictactoe" ? board.state : [];
    expect(state.filter((cell) => cell === "black").length).toBe(3);
    expect(state.filter((cell) => cell === "white").length).toBe(3);
    expect(verifyHistory(session).ok).toBe(true);
  });

  it("builds a different board when the move log is withheld", () => {
    // The control for the test above. Applied without the log, the same move
    // lifts the lowest-numbered mark instead of the oldest, so the two paths
    // end on different boards. This is the failure mode threading the log
    // exists to prevent, and it is silent: both boards look like a legal
    // position, and the player who loses a mark they expected to keep has no
    // way to tell which rule ran.
    const engine = getSessionEngine("tictactoe");
    // The same seven plies as the test above, so the only difference between the
    // two runs is whether the log is handed over.
    const to: Coordinates[] = [
      { x: 2, y: 2 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ];

    let withLog = engine.createInitialBoard();
    let withoutLog = engine.createInitialBoard();
    const history: { player: PlayerColor; to: Coordinates }[] = [];
    to.forEach((coord, index) => {
      const player: PlayerColor = index % 2 === 0 ? "black" : "white";
      withLog = engine.applyMove(withLog, { to: coord }, player, {
        history: history.filter((entry) => entry.player === player),
      }).board;
      withoutLog = engine.applyMove(withoutLog, { to: coord }, player).board;
      history.push({ player, to: coord });
    });

    // Named in the assertion, so a failure says which mark each rule lifted
    // rather than just "the boards differ".
    const lifted = (board: UniversalBoard, index: number) => {
      const state = board.kind === "tictactoe" ? board.state : [];
      return state[index] ?? null;
    };
    expect(boardStatesEqual(withLog, withoutLog)).toBe(false);
    // The log's answer: black's first mark (cell 8) went.
    expect(lifted(withLog, 8)).toBeNull();
    // The board-only answer: the lowest-numbered mark (cell 2) went instead.
    expect(lifted(withoutLog, 8)).toBe("black");
    expect(lifted(withoutLog, 2)).toBeNull();
  });

  it("reports a divergence when the snapshot does not match the move list", () => {
    const session = sessionFor("tictactoe");
    session.history = [
      { id: "m1", gameId: session.id, ply: 1, player: "black", to: { x: 0, y: 0 }, timestamp: 1 },
    ];
    // The snapshot never received the move, so replay disagrees with it.
    const result = verifyHistory(session);
    expect(result.ok).toBe(false);
    expect(result.reason).not.toBeNull();
  });
});

describe("replayMoves", () => {
  /**
   * Plays a Reversi line by asking the engine for legal moves rather than
   * hardcoding them, so the fixture cannot drift from the rules. Reversi is the
   * game that reaches a pass, which is exactly the case a coordinate-only
   * replay cannot reconstruct on its own.
   */
  function reversiPassLine(): { moves: MoveRecord[]; finalBoard: UniversalBoard } {
    const session = sessionFor("reversi");
    const engine = getSessionEngine("reversi");
    let board = session.boardSnapshot;
    const moves: MoveRecord[] = [];
    let player: PlayerColor = "black";

    for (let ply = 1; ply <= 10; ply += 1) {
      const legal = engine.getLegalSquares(board, player);
      if (legal.length === 0) {
        // A pass: the move log records the ply anyway, and the engine's own
        // `passesTurn` result is what the replay re-derives from.
        const square = engine.getSelectableSquares(board, player);
        expect(square.length).toBeGreaterThan(0);
        const to = square[0] as Coordinates;
        moves.push({
          id: `m${ply}`,
          gameId: session.id,
          ply,
          player,
          to,
          payload: encodeMovePayload({ notation: "pass", passesTurn: true }),
          timestamp: ply,
        });
        continue;
      }
      const to = legal[ply % legal.length] as Coordinates;
      const result = engine.applyMove(board, { to }, player);
      board = result.board;
      moves.push({
        id: `m${ply}`,
        gameId: session.id,
        ply,
        player,
        to,
        payload: encodeMovePayload({ notation: "x", passesTurn: result.passesTurn }),
        timestamp: ply,
      });
      if (!result.passesTurn) player = opponentOf(player);
    }

    return { moves, finalBoard: board };
  }

  it("reproduces the board a line of moves produced", () => {
    const { moves, finalBoard } = reversiPassLine();
    const { board } = replayMoves(getSessionEngine("reversi").createInitialBoard(), moves);
    expect(boardStatesEqual(board, finalBoard)).toBe(true);
  });

  it("throws, naming the ply, when the engine rejects a move", () => {
    // White cannot claim a square black already owns, so the second ply is
    // rejected even though the turn order is correct.
    const illegal: MoveRecord[] = [
      { id: "m1", gameId: "g", ply: 1, player: "black", to: { x: 0, y: 0 }, timestamp: 1 },
      { id: "m2", gameId: "g", ply: 2, player: "white", to: { x: 0, y: 0 }, timestamp: 2 },
    ];
    // Failing loudly is the point of the integrity gate: a half-replayed board
    // would look like a valid position to everything downstream.
    expect(() =>
      replayMoves(getSessionEngine("tictactoe").createInitialBoard(), illegal)
    ).toThrow(/ply 2/);
  });

  it("throws when a recorded mover does not match the turn order", () => {
    const outOfTurn: MoveRecord[] = [
      {
        id: "m1",
        gameId: "g",
        ply: 1,
        player: "white",
        to: { x: 0, y: 0 },
        timestamp: 1,
      },
    ];
    expect(() =>
      replayMoves(getSessionEngine("tictactoe").createInitialBoard(), outOfTurn)
    ).toThrow(/expected black/);
  });

  it("replays an empty move list to the starting board", () => {
    const engine = getSessionEngine("connect4");
    const { board, winner, isDraw } = replayMoves(engine.createInitialBoard(), []);
    expect(winner).toBeNull();
    expect(isDraw).toBe(false);
    expect(boardStatesEqual(board, engine.createInitialBoard())).toBe(true);
  });

  it("reports the winner produced by the final ply of a line", () => {
    const session = sessionFor("tictactoe");
    const engine = getSessionEngine("tictactoe");
    const to: Coordinates[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    const moves = to.map((coord, index) => ({
      id: `m${index + 1}`,
      gameId: session.id,
      ply: index + 1,
      player: (index % 2 === 0 ? "black" : "white") as PlayerColor,
      to: coord,
      timestamp: index + 1,
    }));
    const { winner, isDraw } = replayMoves(engine.createInitialBoard(), moves);
    expect(winner).toBe("black");
    expect(isDraw).toBe(false);
  });
});

describe("session engine: the Reversi pass", () => {
  /**
   * The only one of the six games where a player can be left with no move. The
   * engine reports it as `passesTurn` rather than handing the turn over, and the
   * session keeps the same seat. Two things have to hold at once: the move must
   * not raise, and the mover must not lose the turn.
   */
  it("keeps the mover's turn when the opponent has nothing to play, without raising", () => {
    const engine = getSessionEngine("reversi");
    const state: ReversiBoard = Array.from({ length: 8 }, () => Array(8).fill(null));
    // Black at b5 and a1, white at c5 and b1. Playing d5 flips c5, and that
    // takes away the only move white had: its reply at a5 was only legal
    // because black's stones at b5 and c5 ended on white's c5. Black still has
    // a move of its own, so the game is not over — only the turn is.
    state[4]![1] = "black";
    state[4]![2] = "white";
    state[0]![0] = "black";
    state[0]![1] = "white";
    const board: UniversalBoard = { kind: "reversi", state };

    // Sanity: white can answer this one, so the pass below is a fact about the
    // position that black creates rather than a flag left over from the last ply.
    expect(engine.getLegalSquares(board, "white").map((c) => `${c.x},${c.y}`)).toEqual(["0,4"]);

    const result = engine.applyMove(board, { to: { x: 3, y: 4 } }, "black");
    // No throw, and the turn is the mover's to play again. Handing it over would
    // leave white to move with no move, which is how a session ends up showing a
    // board nobody can act on and no explanation for it.
    expect(result.passesTurn).toBe(true);
    expect(result.board).not.toBe(board);
    expect(result.winner).toBeNull();
    expect(result.isDraw).toBe(false);
    // The flip landed, so the board advanced rather than quietly refusing, and
    // the same seat still has a move of its own to make.
    expect(engine.getLegalSquares(result.board, "black").map((c) => `${c.x},${c.y}`)).toEqual(["2,0"]);
    expect(engine.getLegalSquares(result.board, "white")).toHaveLength(0);
  });

  it("reports a result when a pass leaves nobody able to move", () => {
    const engine = getSessionEngine("reversi");
    const board: UniversalBoard = { kind: "reversi", state: emptyReversiWithBlackAtOrigin() };

    const result = engine.applyMove(board, { to: { x: 3, y: 3 } }, "black");
    // Black flipped away the last two white discs, so nobody can move: the pass
    // and the end of the game are the same fact, and the game is over on count
    // rather than left hanging because the opponent had no move.
    expect(result.passesTurn).toBe(true);
    expect(result.winner).toBe("black");
    expect(result.isDraw).toBe(false);
  });
});

/**
 * Black on a1 with white on b2 and c3: black's only move is d4, which flips both
 * white discs away. Contrived, and documented as such in the engine test that
 * covers the same position from the rules' side.
 */
function emptyReversiWithBlackAtOrigin(): ReversiBoard {
  const state: ReversiBoard = Array.from({ length: 8 }, () => Array(8).fill(null));
  state[0]![0] = "black";
  state[1]![1] = "white";
  state[2]![2] = "white";
  return state;
}

describe("engine registry", () => {
  it("covers every game kind", () => {
    for (const engine of Object.values(SESSION_ENGINES)) {
      expect(engine.kind).toBeTruthy();
      expect(engine.createInitialBoard()).toBeDefined();
    }
  });

  it("rejects an unknown kind", () => {
    expect(() => getSessionEngine("nope" as never)).toThrow();
  });
});
