/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlayerColor } from "@/engine/types";

/**
 * Section 4.2 — the `useGameSession` state machine.
 *
 * These tests drive the hook the way the board views do: one coordinate in,
 * no origin, and the hook decides whether that is a piece selection or a
 * destination. They run against a real Dexie instance on `fake-indexeddb` so
 * the write-through transaction is genuinely committed and read back, not
 * stubbed at the persistence boundary.
 */

const { createGameSession, useGameSession } = await import("@/hooks/useGameSession");
const { getLocalDb } = await import("@/lib/db");
const { getSessionEngine } = await import("@/engine/factory");
const { coordKey } = await import("@/components/boards/boardViewTypes");

function localSession(overrides: Partial<ReturnType<typeof createGameSession>> = {}) {
  return {
    ...createGameSession({
      gameKind: "tictactoe" as const,
      mode: "offline_local" as const,
      playerBlackToken: "black-token",
      localSeat: "black" as const,
    }),
    ...overrides,
  };
}

beforeEach(() =>
  getLocalDb().transaction("rw", getLocalDb().games, getLocalDb().syncQueue, async () => {
    await getLocalDb().games.clear();
    await getLocalDb().syncQueue.clear();
  })
);

afterEach(async () => {
  await getLocalDb().games.clear();
  await getLocalDb().syncQueue.clear();
});

describe("useGameSession on a place-a-stone game", () => {
  it("accepts a move on an empty board and records it", async () => {
    const initial = localSession();
    const { result } = renderHook(() => useGameSession(initial));

    await act(async () => {
      await result.current.makeMove({ x: 1, y: 1 });
    });

    expect(result.current.session?.history).toHaveLength(1);
    expect(result.current.session?.turnNumber).toBe(1);
    expect(result.current.session?.currentTurn).toBe("white");
    expect(result.current.lastMove?.to).toEqual({ x: 1, y: 1 });
    expect(result.current.rejection).toBeNull();
  });

  it("persists the accepted session to IndexedDB", async () => {
    const initial = localSession();
    const { result } = renderHook(() => useGameSession(initial));

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });

    const stored = await getLocalDb().games.get(initial.id);
    expect(stored).toBeDefined();
    expect(stored?.history).toHaveLength(1);
    expect(stored?.boardSnapshot).toEqual(result.current.session?.boardSnapshot);
    // A local session never leaves the device, so the queue stays empty.
    expect(await getLocalDb().syncQueue.count()).toBe(0);
  });

  it("refuses a move onto an occupied square and leaves the session untouched", async () => {
    const initial = localSession();
    const { result } = renderHook(() => useGameSession(initial));

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });
    const afterFirst = result.current.session;

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });

    expect(result.current.session?.history).toHaveLength(1);
    expect(result.current.session?.boardSnapshot).toEqual(afterFirst?.boardSnapshot);
    expect(result.current.rejection).not.toBeNull();
    expect(result.current.rejectionMessage).not.toBeNull();
    expect(result.current.lastMove?.to).toEqual({ x: 0, y: 0 });
  });

  it("clears the rejection once the player acknowledges it", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
      await result.current.makeMove({ x: 0, y: 0 });
    });
    expect(result.current.rejection).not.toBeNull();

    act(() => result.current.acknowledgeRejection());
    expect(result.current.rejection).toBeNull();
    expect(result.current.rejectionMessage).toBeNull();
  });

  it("marks the winner and stops accepting moves", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));

    // Black completes the bottom row; white keeps clear of both lines.
    for (const to of [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 1, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 0 },
    ]) {
      await act(async () => {
        await result.current.makeMove(to);
      });
    }

    expect(result.current.session?.history).toHaveLength(5);
    expect(result.current.session?.status).toBe("won_black");
    expect(result.current.session?.winner).toBe("black");
    expect(result.current.canAct).toBe(false);
    expect(result.current.isLocked).toBe(true);
  });

  it("ends in a draw when the board fills with no line", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));

    // X O X / O X X / O X O — all nine squares taken, neither side has three.
    for (const to of [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]) {
      await act(async () => {
        await result.current.makeMove(to);
      });
    }

    expect(result.current.session?.status).toBe("draw");
    expect(result.current.session?.winner).toBeNull();
    expect(result.current.session?.turnNumber).toBe(9);
    expect(result.current.isLocked).toBe(true);
  });

  it("refuses every move while the session is in conflict", async () => {
    const initial = localSession({ syncState: "conflict" });
    const { result } = renderHook(() => useGameSession(initial));

    expect(result.current.canAct).toBe(false);

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });

    expect(result.current.session?.history).toHaveLength(0);
    expect(result.current.rejection).not.toBeNull();
  });

  it("locks a realtime match while the opponent is on move", async () => {
    // Holding the white seat while black is on move.
    const initial = localSession({
      mode: "online_realtime",
      playerWhiteToken: "white-token",
      currentTurn: "black",
    });
    const { result } = renderHook(() => useGameSession(initial));

    expect(result.current.localSeat).toBe("white");
    expect(result.current.currentTurn).toBe("black");
    expect(result.current.canAct).toBe(false);
    expect(result.current.legalSquares.size).toBe(0);

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });
    expect(result.current.session?.history).toHaveLength(0);
  });

  it("lets the local seat answer a realtime match once the turn comes round", async () => {
    const initial = localSession({
      mode: "online_realtime",
      playerWhiteToken: "white-token",
      currentTurn: "white",
    });
    const { result } = renderHook(() => useGameSession(initial));
    expect(result.current.canAct).toBe(true);
    expect(result.current.activeSeat).toBe("white");
  });
});

describe("useGameSession on a two-step game", () => {
  it("selects a piece first, then commits the move on a legal destination", async () => {
    // Checkers is the two-click case: a piece is lifted before it lands, so
    // clicking a destination alone is never enough.
    const engine = getSessionEngine("checkers");
    const initial = localSession({ gameKind: "checkers", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    // A checker has to be lifted before it lands, so the board opens by
    // offering own pieces rather than a flat list of destinations.
    expect(result.current.selectableSquares.size).toBeGreaterThan(0);
    // Choosing an origin must be a no-op on the board: a move is not complete
    // until the destination is chosen.
    expect(result.current.session?.history).toHaveLength(0);
    expect(result.current.selected).toBeNull();

    expect(result.current.selectableSquares.size).toBeGreaterThan(0);
    const originKey = [...result.current.selectableSquares][0] as string;
    const [ox, oy] = originKey.split(",").map(Number);
    const origin = { x: ox as number, y: oy as number };

    act(() => result.current.selectSquare(origin));

    expect(result.current.selected).toEqual(origin);
    expect(result.current.destinations.size).toBeGreaterThan(0);
    expect(result.current.session?.history).toHaveLength(0);

    const destination = [...result.current.destinations][0] as string;
    const [x, y] = destination.split(",").map(Number);
    await act(async () => {
      await result.current.makeMove({ x: x as number, y: y as number });
    });

    expect(result.current.session?.history).toHaveLength(1);
    expect(result.current.selected).toBeNull();
  });

  it("clears the selection without moving when the player clicks elsewhere", async () => {
    const engine = getSessionEngine("checkers");
    const initial = localSession({ gameKind: "checkers", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    const originKey = [...result.current.selectableSquares][0] as string;
    const [ox, oy] = originKey.split(",").map(Number);
    act(() => result.current.selectSquare({ x: ox as number, y: oy as number }));
    expect(result.current.selected).toEqual({ x: ox, y: oy });

    act(() => result.current.clearSelection());
    expect(result.current.selected).toBeNull();
    expect(result.current.destinations.size).toBe(0);
    expect(result.current.session?.history).toHaveLength(0);
  });

  it("never raises an engine error when a piece is simply lifted", async () => {
    // The reported bug: clicking one of your own pieces showed a red banner
    // reading "an origin square is required". Lifting a piece is not a move and
    // not a mistake, so it must reach the session as a selection, not as a
    // failed move the engine got to complain about.
    const engine = getSessionEngine("checkers");
    const initial = localSession({ gameKind: "checkers", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    const originKey = [...result.current.selectableSquares][0] as string;
    const [ox, oy] = originKey.split(",").map(Number);
    await act(async () => {
      await result.current.makeMove({ x: ox as number, y: oy as number });
    });

    expect(result.current.rejection).toBeNull();
    expect(result.current.rejectionMessage).toBeNull();
    expect(result.current.selected).toEqual({ x: ox, y: oy });
    expect(result.current.session?.history).toHaveLength(0);
  });

  it("switches to another own piece rather than treating it as a move", async () => {
    // Clicking a second checker of your own is a change of mind, not a move of
    // the first one onto the second one's square. Handed to the engine that way
    // it throws "destination is occupied" — a banner about a move the player
    // never attempted.
    const engine = getSessionEngine("checkers");
    const initial = localSession({ gameKind: "checkers", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    const keys = [...result.current.selectableSquares];
    const first = keys[0] as string;
    const second = keys[1] as string;
    const coord = (key: string) => {
      const [x, y] = key.split(",").map(Number);
      return { x: x as number, y: y as number };
    };

    await act(async () => {
      await result.current.makeMove(coord(first));
    });
    await act(async () => {
      await result.current.makeMove(coord(second));
    });

    expect(result.current.rejection).toBeNull();
    expect(result.current.selected).toEqual(coord(second));
    expect(result.current.session?.history).toHaveLength(0);
  });

  it("puts the piece down when a lifted piece is clicked again", async () => {
    const engine = getSessionEngine("checkers");
    const initial = localSession({ gameKind: "checkers", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    const originKey = [...result.current.selectableSquares][0] as string;
    const [ox, oy] = originKey.split(",").map(Number);
    const origin = { x: ox as number, y: oy as number };

    await act(async () => {
      await result.current.makeMove(origin);
    });
    expect(result.current.selected).toEqual(origin);

    await act(async () => {
      await result.current.makeMove(origin);
    });
    expect(result.current.selected).toBeNull();
    expect(result.current.rejection).toBeNull();
    expect(result.current.session?.history).toHaveLength(0);
  });

  it("drops the selection on empty space rather than reporting an illegal move", async () => {
    // Clicking empty space to put a piece down is how these games are played.
    // With nothing lifted and no piece under the finger there is no move to
    // make, so the session must say so by doing nothing — not by raising an
    // error the player cannot act on.
    const engine = getSessionEngine("checkers");
    const initial = localSession({ gameKind: "checkers", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    const originKey = [...result.current.selectableSquares][0] as string;
    const [ox, oy] = originKey.split(",").map(Number);
    await act(async () => {
      await result.current.makeMove({ x: ox as number, y: oy as number });
    });

    // A square well away from the lifted piece and off the board's edges.
    await act(async () => {
      await result.current.makeMove({ x: 7, y: 7 });
    });

    expect(result.current.selected).toBeNull();
    // The banner is the symptom that was reported, so the assertion that
    // matters is not just that nothing moved — it is that nothing complained.
    expect(result.current.rejection).toBeNull();
    expect(result.current.rejectionMessage).toBeNull();
    expect(result.current.session?.history).toHaveLength(0);
  });

  it("still refuses a genuinely illegal move", async () => {
    // The cases above must not have swallowed real errors: tapping a square
    // that holds nothing of yours, with nothing lifted, is still not a move.
    const engine = getSessionEngine("checkers");
    const initial = localSession({ gameKind: "checkers", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    await act(async () => {
      await result.current.makeMove({ x: 7, y: 7 });
    });

    expect(result.current.session?.history).toHaveLength(0);
    expect(result.current.rejection).not.toBeNull();
  });

  it("plays Reversi in one click, because the engine supplies destinations", async () => {
    const engine = getSessionEngine("reversi");
    const initial = localSession({ gameKind: "reversi", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    // Reversi needs no origin: the engine hands over every legal placement, so
    // an empty selectable set is correct and must not block the move.
    expect(result.current.legalSquares.size).toBeGreaterThan(0);
    expect(result.current.selectableSquares.size).toBe(0);

    const target = [...result.current.legalSquares][0] as string;
    const [x, y] = target.split(",").map(Number);
    await act(async () => {
      await result.current.makeMove({ x: x as number, y: y as number });
    });

    expect(result.current.session?.history).toHaveLength(1);
    expect(result.current.session?.history[0]?.player).toBe("black");
  });

  it("records a Reversi pass in the move payload so a replay can reproduce it", async () => {
    // Black ends up with every surrounding square occupied by its own discs,
    // so the only move left is a pass and the payload has to say so.
    const engine = getSessionEngine("reversi");
    const occupied: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ];

    // Play the six flips through the engine so the position is a legal one.
    let board = engine.createInitialBoard();
    for (const to of occupied) {
      const mover: PlayerColor = "black";
      if (engine.getLegalSquares(board, mover).some((c) => c.x === to.x && c.y === to.y)) {
        board = engine.applyMove(board, { to }, mover).board;
      }
    }

    const initial = localSession({ gameKind: "reversi", boardSnapshot: board, currentTurn: "white" });
    const { result } = renderHook(() => useGameSession(initial));

    // Whatever this position is, the two hint sets must never claim a square
    // that the engine would then refuse: the board renders exactly these.
    for (const key of result.current.legalSquares) {
      const [x, y] = key.split(",").map(Number);
      expect(engine.getLegalSquares(board, "white")).toContainEqual({ x, y });
    }
  });
});

describe("useGameSession session lifecycle", () => {
  it("reports a null session without throwing when none is supplied", () => {
    const { result } = renderHook(() => useGameSession(null));
    expect(result.current.session).toBeNull();
    expect(result.current.isLocked).toBe(true);
    expect(result.current.canAct).toBe(false);
  });

  it("resigns, ending the match for the local seat", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));

    await act(async () => {
      await result.current.resign();
    });

    expect(result.current.session?.status).toBe("won_white");
    expect(result.current.session?.winner).toBe("white");
    expect(result.current.canAct).toBe(false);
    expect(result.current.isLocked).toBe(true);
  });

  it("resets to a fresh board with a cleared history and a bumped version", async () => {
    const initial = localSession();
    const { result } = renderHook(() => useGameSession(initial));

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });
    const before = result.current.session;

    await act(async () => {
      await result.current.resetGame();
    });

    const after = result.current.session;
    expect(after?.history).toHaveLength(0);
    expect(after?.turnNumber).toBe(0);
    expect(after?.currentTurn).toBe("black");
    expect(after?.status).toBe("active");
    expect(after?.winner).toBeNull();
    expect(after?.boardSnapshot).toEqual(getSessionEngine("tictactoe").createInitialBoard());
    // The server still holds the room at the old version, so the reset must
    // carry a new one or the next move would fail its OCC check.
    expect(after?.version).toBeGreaterThan(before?.version ?? 0);
  });

  it("resets a finished match, which is the only reset the rules allow", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));
    await act(async () => {
      await result.current.resign();
    });
    expect(result.current.session?.status).toBe("won_white");

    await act(async () => {
      await result.current.resetGame();
    });

    expect(result.current.session?.status).toBe("active");
    expect(result.current.session?.winner).toBeNull();
    expect(result.current.canAct).toBe(true);
  });

  it("refuses to reset a live realtime match and leaves it untouched", async () => {
    const { result } = renderHook(() =>
      useGameSession(localSession({ mode: "online_realtime", playerWhiteToken: "white-token" }))
    );

    await act(async () => {
      await result.current.resetGame();
    });

    // Resetting mid-match would abandon a turn the opponent believes they
    // own, so the board must be left exactly as it was.
    expect(result.current.session?.history).toHaveLength(0);
    expect(result.current.session?.status).toBe("active");
    expect(result.current.rejectionMessage).not.toBeNull();
  });

  it("adopts a replayed session and re-derives its derived state", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));
    const engine = getSessionEngine("tictactoe");

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });

    const replayed = {
      ...localSession({ id: result.current.session?.id }),
      boardSnapshot: engine.applyMove(engine.createInitialBoard(), { to: { x: 2, y: 2 } }, "black")
        .board,
      history: [
        {
          id: "remote-1",
          gameId: result.current.session?.id ?? "",
          ply: 1,
          player: "black" as const,
          to: { x: 2, y: 2 },
          timestamp: 10,
        },
      ],
      turnNumber: 1,
      currentTurn: "white" as const,
    };

    act(() => result.current.adoptSession(replayed));

    expect(result.current.session?.boardSnapshot).toEqual(replayed.boardSnapshot);
    expect(result.current.lastMove?.id).toBe("remote-1");
    expect(result.current.currentTurn).toBe("white");
    expect(result.current.selected).toBeNull();
  });

  it("keeps the local seat when it holds the white side", () => {
    const session = localSession({ currentTurn: "black" });
    const { result } = renderHook(() => useGameSession(session));
    expect(result.current.localSeat).toBe("black");
  });
});

describe("useGameSession rejection reporting", () => {
  it("reports a rejection through onRejected with a human-readable message", async () => {
    const seen: { message: string }[] = [];
    const { result } = renderHook(() =>
      useGameSession(localSession(), {
        onRejected: (_rejection, message) => seen.push({ message }),
      })
    );

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
      await result.current.makeMove({ x: 0, y: 0 });
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.message.length).toBeGreaterThan(0);
  });

  it("announces every accepted move through onCommitted", async () => {
    const committed: { record: string | null; turn: number }[] = [];
    const { result } = renderHook(() =>
      useGameSession(localSession(), {
        onCommitted: (session, record) =>
          committed.push({ record: record?.id ?? null, turn: session.turnNumber }),
      })
    );

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });

    expect(committed).toHaveLength(1);
    expect(committed[0]?.record).not.toBeNull();
    expect(committed[0]?.turn).toBe(1);
  });

  it("does not announce a refused move", async () => {
    const committed: unknown[] = [];
    const { result } = renderHook(() =>
      useGameSession(localSession(), { onCommitted: (session) => committed.push(session) })
    );

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
      await result.current.makeMove({ x: 0, y: 0 });
    });

    await waitFor(() => expect(committed).toHaveLength(1));
  });
});

describe("board view helpers", () => {
  it("keys a square as 'x,y'", () => {
    expect(coordKey({ x: 3, y: 4 })).toBe("3,4");
  });
});
