/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckersCell, Coordinates, PlayerColor, UniversalBoard } from "@/engine/types";

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
  it("clears the winning line when a finished match is reset", async () => {
    // The reset is a shallow copy — `{ ...active, status: "active", winner:
    // null }` — so every field it does not name survives into the new match.
    // `winningLine` is one of them, and it is the one field that survives
    // *visibly*: the next game opens on an empty nine-cell board wearing the
    // last game's three green tiles, which reads as a line nobody played.
    //
    // Driven end to end rather than by seeding the session, so the win has to be
    // a real one and the reset has to be the real handler.
    const initial = localSession();
    const { result } = renderHook(() => useGameSession(initial));

    // Black takes the left column: (0,0), (0,1), (0,2). White plays elsewhere so
    // the column is never contested.
    for (const coord of [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
    ] as Coordinates[]) {
      await act(async () => {
        await result.current.makeMove(coord);
      });
    }

    // The line is really there first, or the assertion below proves nothing.
    expect(result.current.session?.status).not.toBe("active");
    expect(result.current.session?.winner).toBe("black");
    expect(result.current.session?.winningLine).toHaveLength(3);

    await act(async () => {
      await result.current.resetGame();
    });

    const after = result.current.session;
    expect(after?.status).toBe("active");
    expect(after?.winner).toBeNull();
    // The three that must not survive the reset.
    expect(after?.winningLine).toBeNull();
    // And the rest of the opening position, so this is a clean board and not a
    // board with one tile left lit.
    expect(after?.history).toHaveLength(0);
    expect(after?.turnNumber).toBe(0);
    expect(after?.boardSnapshot).toEqual(getSessionEngine("tictactoe").createInitialBoard());
  });

  it("clears the winning line on a resignation, which has no line to keep", async () => {
    // The other terminal path, and a different mistake. A resignation is
    // decided by a player rather than by a row of stones, so there is no line
    // to report — but the session is built by spreading a *live* one, so a line
    // set moments before the resignation would otherwise be carried into a
    // finished match and shown as the thing that decided it.
    const initial = localSession();
    const { result } = renderHook(() => useGameSession(initial));

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });
    // A single move completes no line, so this is the honest way to get a
    // non-null line onto a session that is still active.
    expect(result.current.session?.winningLine).toBeNull();

    await act(async () => {
      await result.current.resign();
    });

    expect(result.current.session?.status).not.toBe("active");
    expect(result.current.session?.winner).toBe("white");
    expect(result.current.session?.winningLine).toBeNull();
  });

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

  it("keeps the game live past nine plies, because a side holds three marks at most", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));

    // The complaint this rule answers: the old game filled all nine squares and
    // called it a draw, so two players who played perfectly had nothing to win.
    // With a cap of three marks a side, six marks are the most the board can
    // ever hold, three cells are always open, and the game cannot end in a draw.
    // A deterministic sweep, so the positions are reproducible.
    for (let scan = 0; scan < 40; scan += 1) {
      const board = result.current.board;
      if (board.kind !== "tictactoe") throw new Error("expected a tic-tac-toe board");
      const index = scan % 9;
      if (board.state[index] !== null) continue;

      await act(async () => {
        await result.current.makeMove({ x: index % 3, y: Math.floor(index / 3) });
      });

      expect(result.current.session?.status).not.toBe("draw");
      expect(board.state.filter((cell) => cell !== null).length).toBeLessThanOrEqual(6);
      if (result.current.session?.status !== "active") break;
    }

    // The sweep ends in a line, not in a full board: the outcome the cap exists
    // to guarantee.
    expect(result.current.session?.status).toMatch(/^won_(black|white)$/);
    expect(result.current.session?.winner).not.toBeNull();
    expect(result.current.session?.turnNumber).toBeGreaterThan(4);
  });

  it("tells the board which mark the next move will lift, and only when one is at stake", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));
    expect(result.current.vanishingSquares).toEqual(new Set());

    // A game that never completes a line, so it is still in progress at the end.
    for (const to of [
      { x: 0, y: 0 }, // black
      { x: 1, y: 0 }, // white
      { x: 2, y: 0 }, // black
      { x: 1, y: 1 }, // white
      { x: 0, y: 1 }, // black — black now holds three
    ]) {
      await act(async () => {
        await result.current.makeMove(to);
      });
    }

    // It is white's move, and white holds two marks, so nothing is at stake. The
    // hint belongs to the player about to move: warning black about a mark that
    // white will never lift is a hint that lies.
    expect(result.current.vanishingSquares).toEqual(new Set());

    await act(async () => {
      await result.current.makeMove({ x: 2, y: 1 }); // white's third
    });
    // Now black is on move holding three marks, and the hint names the oldest of
    // them — the first square played, not the lowest-numbered.
    expect(result.current.vanishingSquares).toEqual(new Set(["0,0"]));

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 2 }); // black's fourth
    });
    // Black's oldest mark is gone, so the queue has moved on and white's own
    // oldest mark is the one now at stake.
    expect(result.current.vanishingSquares).toEqual(new Set(["1,0"]));
  });

  it("stops hinting at a vanishing mark once the game is over", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));

    // Black completes the top row with its third mark; white plays the bottom
    // row's first two cells, which is not a line.
    for (const to of [
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 0 },
    ]) {
      await act(async () => {
        await result.current.makeMove(to);
      });
    }
    expect(result.current.session?.status).toBe("won_black");

    // The winner holds a full set of three, and the board is locked. A ring
    // still pulsing round one of them would invite a move the session refuses,
    // so the hint is empty — the same emptiness a locked realtime board gets.
    expect(result.current.isLocked).toBe(true);
    expect(result.current.vanishingSquares).toEqual(new Set());
  });

  it("hands the board the cells that won, and forgets them the moment a new game starts", async () => {
    const { result } = renderHook(() => useGameSession(localSession()));

    // Nothing is at stake on an empty board, so the board is handed an empty
    // set rather than no set at all.
    expect(result.current.winningSquares).toEqual(new Set());

    for (const to of [
      { x: 0, y: 0 }, // black
      { x: 1, y: 1 }, // white
      { x: 0, y: 1 }, // black
      { x: 2, y: 2 }, // white
      { x: 0, y: 2 }, // black — the left column
    ]) {
      await act(async () => {
        await result.current.makeMove(to);
      });
    }

    // Black completed the left column on the fifth ply.
    expect(result.current.session?.status).toBe("won_black");
    expect(result.current.winningSquares).toEqual(new Set(["0,0", "0,1", "0,2"]));
    // The line is what the board draws, so it has to survive the lock: a
    // finished board that refused the highlight would be hiding the one thing
    // worth looking at.
    expect(result.current.isLocked).toBe(true);

    await act(async () => {
      await result.current.resetGame();
    });

    // An empty board with three cells ringed as a win is the failure this
    // guards: the highlight outliving the position that earned it.
    expect(result.current.session?.status).toBe("active");
    expect(result.current.winningSquares).toEqual(new Set());
  });

  it("leaves the winning squares empty for a game with no line to draw", async () => {
    // Reversi is won by a count of discs. A result is still a result, and the
    // board still has to be handed something — an empty set, never a guess.
    const { result } = renderHook(() =>
      useGameSession(
        localSession({
          gameKind: "reversi" as const,
          boardSnapshot: getSessionEngine("reversi").createInitialBoard(),
        })
      )
    );

    const legal = getSessionEngine("reversi").getLegalSquares(
      result.current.session!.boardSnapshot,
      "black"
    );
    await act(async () => {
      await result.current.makeMove(legal[0] as Coordinates);
    });

    expect(result.current.session?.status).toBe("active");
    expect(result.current.winningSquares).toEqual(new Set());
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

  it("keeps the jumping piece selected so a capture chain can be finished", async () => {
    // A capture is not over when the man lands. With a second victim ahead the
    // engine holds the turn and names the square the chain continues from, and
    // the hook keeps that piece in hand — otherwise the player is told they may
    // jump again and given no way to do it.
    // A hand-built position, because the opening setup has no jumps in it at
    // all: one black man at (1,1) with white pieces at (2,2) and (4,4) ahead of
    // it, which is a chain of exactly two jumps and no third.
    const rows: CheckersCell[][] = Array.from({ length: 8 }, () =>
      Array<CheckersCell>(8).fill(null)
    );
    rows[1]![1] = { color: "black", type: "pawn" };
    rows[2]![2] = { color: "white", type: "pawn" };
    rows[4]![4] = { color: "white", type: "pawn" };
    const position: UniversalBoard = { kind: "checkers", state: rows };

    const initial = localSession({ gameKind: "checkers", boardSnapshot: position });
    const { result } = renderHook(() => useGameSession(initial));

    const landing = { x: 3, y: 3 };
    // Captured into a list rather than a reassigned `let`: TypeScript narrows a
    // variable assigned only inside a closure to `never` at the point of use,
    // which is the compiler being right about a pattern that does not work.
    const outcomes: { message?: string }[] = [];
    await act(async () => {
      outcomes.push(await result.current.makeMove({ x: 1, y: 1 }));
    });
    await act(async () => {
      outcomes.push(await result.current.makeMove(landing));
    });

    expect(result.current.rejection).toBeNull();
    // The turn never went over, and the piece is still the one in hand.
    expect(result.current.session?.currentTurn).toBe("black");
    expect(result.current.selected).toEqual(landing);
    // The one legal continuation is offered, and it is the real one.
    expect([...result.current.destinations]).toEqual([coordKey({ x: 5, y: 5 })]);
    // And the message says why, rather than claiming the board ran out of moves.
    expect(outcomes[1]?.message).toBe("That piece can jump again — keep going.");
    // The first victim is gone and the second is still standing.
    const after = result.current.session?.boardSnapshot;
    if (after?.kind !== "checkers") throw new Error("expected a checkers board");
    expect(after.state[2]![2]).toBeNull();
    expect(after.state[4]![4]).toEqual({ color: "white", type: "pawn" });

    // Finishing the chain hands the turn over and clears the selection.
    await act(async () => {
      await result.current.makeMove({ x: 5, y: 5 });
    });
    expect(result.current.session?.currentTurn).toBe("white");
    expect(result.current.selected).toBeNull();
    expect(result.current.session?.history).toHaveLength(2);
  });

  it("ends the capture chain on a crowning jump and hands the turn to the opponent", async () => {
    // The bug: a man that jumps onto the king row is crowned, and the engine used
    // to let the chain carry on as the new king. The player kept clicking and
    // kept taking, the opponent never got a turn, and a piece went off the board
    // that the rules said was still theirs.
    //
    // Position: a black man on a5, white men on b6 and d6. The man jumps b6 and
    // lands on c7, crowning. As a king it could then take d6 — and must not.
    const rows: CheckersCell[][] = Array.from({ length: 8 }, () =>
      Array<CheckersCell>(8).fill(null)
    );
    rows[5]![0] = { color: "black", type: "pawn" };
    rows[6]![1] = { color: "white", type: "pawn" };
    rows[6]![3] = { color: "white", type: "pawn" };
    const position: UniversalBoard = { kind: "checkers", state: rows };

    const { result } = renderHook(() =>
      useGameSession(localSession({ gameKind: "checkers", boardSnapshot: position }))
    );

    await act(async () => {
      await result.current.makeMove({ x: 0, y: 5 });
    });
    const landing = { x: 2, y: 7 };
    await act(async () => {
      await result.current.makeMove(landing);
    });

    expect(result.current.rejection).toBeNull();
    // The turn is over, and the piece is no longer in hand: the crown ends the
    // move, so there is nothing to continue and the highlight has to go with it.
    expect(result.current.session?.currentTurn).toBe("white");
    expect(result.current.selected).toBeNull();
    expect([...result.current.destinations]).toEqual([]);

    // The capture it made is already off the board, on this ply, and the man is
    // a king. The second white man is untouched — the move it could have made as
    // a king was never made.
    const after = result.current.session?.boardSnapshot;
    if (after?.kind !== "checkers") throw new Error("expected a checkers board");
    expect(after.state[7]![2]).toEqual({ color: "black", type: "king" });
    expect(after.state[5]![0]).toBeNull();
    expect(after.state[6]![1]).toBeNull();
    expect(after.state[6]![3]).toEqual({ color: "white", type: "pawn" });

    // And the opponent really can reply, so the turn passed rather than stalling.
    // Two taps, because the first one only lifts the piece.
    await act(async () => {
      await result.current.makeMove({ x: 3, y: 6 });
    });
    await act(async () => {
      await result.current.makeMove({ x: 2, y: 5 });
    });
    expect(result.current.rejection).toBeNull();
    expect(result.current.session?.history).toHaveLength(2);
    expect(result.current.session?.currentTurn).toBe("black");
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

  it("silently ignores a bare tap in a movement game, with nothing to show for it", async () => {
    // In checkers there is no such thing as "put a piece down here".
    // A tap on a square the player does not own, with nothing lifted, was never
    // a move attempt — it was someone touching the board. Handing it to the
    // engine produced "an origin square is required": a complaint about a
    // protocol detail, in response to a gesture that deserved no response.
    const engine = getSessionEngine("checkers");
    const initial = localSession({ gameKind: "checkers", boardSnapshot: engine.createInitialBoard() });
    const { result } = renderHook(() => useGameSession(initial));

    const outcome = await act(async () => result.current.makeMove({ x: 7, y: 7 }));

    expect(result.current.session?.history).toHaveLength(0);
    expect(result.current.rejection).toBeNull();
    expect(result.current.rejectionMessage).toBeNull();
    expect(result.current.selected).toBeNull();
    expect(outcome).toEqual({ accepted: false, reason: null, message: undefined });
  });

  it("never tells the player that an origin square is required", async () => {
    // Stated as a sweep because the message is the defect: it names a field in
    // a move payload. Whichever way the intent resolver is rewritten, no tap in
    // the movement game may surface it. Hex is deliberately absent — it has no
    // origin square at all, so the message is not merely hidden but impossible.
    for (const gameKind of ["checkers"] as const) {
      const engine = getSessionEngine(gameKind);
      const initial = localSession({ gameKind, boardSnapshot: engine.createInitialBoard() });
      const { result } = renderHook(() => useGameSession(initial));

      // Every square on the board, one at a time, with nothing lifted.
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          await act(async () => {
            await result.current.makeMove({ x, y });
          });
          expect(
            result.current.rejectionMessage ?? "",
            `${gameKind} (${x},${y}) must not explain protocol internals`
          ).not.toContain("origin square");
        }
      }
    }
  });

  it("still refuses a genuinely illegal move in a placement game", async () => {
    // The silent-ignore rule must not have swallowed real errors. A placement
    // game has no origin to pick, so tapping a square the rules forbid *is* an
    // illegal move and the player deserves to be told so.
    const engine = getSessionEngine("tictactoe");
    const afterX = engine.applyMove(engine.createInitialBoard(), { to: { x: 0, y: 0 } }, "black");
    const board = engine.applyMove(afterX.board, { to: { x: 1, y: 1 } }, "white").board;
    const initial = localSession({ gameKind: "tictactoe", boardSnapshot: board });
    const { result } = renderHook(() => useGameSession(initial));

    // (0,0) holds a black mark; placing there is a real illegal move.
    await act(async () => {
      await result.current.makeMove({ x: 0, y: 0 });
    });

    expect(result.current.session?.history).toHaveLength(0);
    expect(result.current.rejection).not.toBeNull();
    expect(result.current.rejectionMessage).toBeTruthy();
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
