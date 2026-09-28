/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * SEC-AUDIT-01 — a reset must not destroy the record of the game it resets.
 *
 * `submit_terminal_update` used to answer `p_clear_history` by deleting every
 * row in `game_moves` for the room. That is the one thing an append-only ledger
 * must never do, and the client is where the consequence is observable: the
 * schema fix stamps each move with the room's `reset_epoch` and advances that
 * epoch instead of deleting anything, and this file pins the client half of
 * that contract.
 *
 * These are the first tests this hook has ever had. It had none, which is why
 * the suite stayed green through the schema change — nothing was asserting
 * anything about the query the client actually sends.
 *
 * The Supabase client is a hand-written fake that *applies the filters it is
 * given* rather than returning a scripted payload. A fake that ignores `.eq`
 * cannot distinguish a client that filters by epoch from one that does not,
 * which is the only distinction under test here.
 */

type Row = Record<string, unknown>;

/** The rows the fake `game_moves` table holds, across every epoch. */
let moveRows: Row[] = [];
/** The `game_rooms` row. `reset_epoch` is the one field these tests turn. */
let roomRow: Row = { id: "room-1", reset_epoch: 0 };
/** Every resolved query, so a test can assert what was actually asked for. */
let queries: { table: string; filters: Record<string, unknown>; order: string | null }[] = [];

type ChannelHandler = (payload: { new: Record<string, unknown> }) => void;
let handlers: { table: string; event: string; callback: ChannelHandler }[] = [];
let subscribed: ((state: string) => void) | null = null;

/** Builds a tictactoe move row in the shape Postgres would return. */
function moveRow(input: {
  id: string;
  epoch: number;
  ply: number;
  player: "black" | "white";
  index: number;
}): Row {
  return {
    id: input.id,
    room_id: "room-1",
    epoch: input.epoch,
    ply: input.ply,
    player: input.player,
    from_coord: null,
    to_coord: tictactoeCoordOf(input.index),
    payload: null,
  };
}

/** The filter set the fake applies to decide which rows a query returns. */
function matches(row: Row, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([column, value]) => row[column] === value);
}

vi.mock("@/lib/supabase", () => {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let order: string | null = null;

    const api = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return api;
      },
      order: (column: string) => {
        order = column;
        return api;
      },
      single: () =>
        Promise.resolve(
          table === "game_rooms" && matches({ id: "room-1", ...roomRow }, filters)
            ? { data: { id: "room-1", ...roomRow }, error: null }
            : { data: null, error: { code: "PGRST116", message: "no rows" } }
        ),
      then: (resolve: (value: unknown) => unknown) => {
        queries.push({ table, filters: { ...filters }, order });
        const rows = moveRows.filter((row) => matches(row, filters));
        const sorted = order === "ply" ? [...rows].sort((a, b) => Number(a.ply) - Number(b.ply)) : rows;
        return Promise.resolve().then(() => resolve({ data: sorted, error: null }));
      },
    };
    return api;
  };

  return {
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from,
      removeChannel: () => Promise.resolve(null),
      channel: () => ({
        on: (type: string, filter: { event: string; table: string }, callback: ChannelHandler) => {
          if (type === "postgres_changes") handlers.push({ table: filter.table, event: filter.event, callback });
          return null;
        },
        subscribe: (callback: (state: string) => void) => {
          subscribed = callback;
          callback("SUBSCRIBED");
          return null;
        },
        unsubscribe: () => undefined,
      }),
    }),
  };
});

const { useSupabaseRealtime } = await import("@/hooks/useSupabaseRealtime");
const { createGameSession } = await import("@/hooks/useGameSession");
const { tictactoeCoordOf } = await import("@/engine/rules/tictactoe");
const { getSessionEngine, replayMoves } = await import("@/engine/factory");

/**
 * Builds the board the client should end up with, using the same public replay
 * path the hook uses. `createInitialBoard` returns a `UniversalBoard`, not the
 * flat engine board `applyTicTacToeMove` takes, so the engine's own move
 * function cannot be used to construct the expected position here.
 */
function boardAfter(indices: readonly number[]) {
  const engine = getSessionEngine("tictactoe");
  return replayMoves(
    engine.createInitialBoard(),
    indices.map((index, turn) => ({
      player: turn % 2 === 0 ? ("black" as const) : ("white" as const),
      to: tictactoeCoordOf(index),
    }))
  ).board;
}

function makeSession(boardIndices: readonly number[] | "initial") {
  const engine = getSessionEngine("tictactoe");
  return {
    ...createGameSession({
      id: "room-1",
      gameKind: "tictactoe",
      mode: "online_realtime" as const,
      playerBlackToken: "black-token",
      playerWhiteToken: "white-token",
    }),
    boardSnapshot: boardIndices === "initial" ? engine.createInitialBoard() : boardAfter(boardIndices),
  };
}

/**
 * The first game's five plies. Black takes 0, 1 and 6, white takes 3 and 4 — no
 * three in a row for either side, so nothing here ends the game early.
 */
const FIRST_GAME = [0, 3, 1, 4, 6];

function renderHookFor(sessionBoardIndices: readonly number[] | "initial") {
  const props = { current: makeSession(sessionBoardIndices) };
  const onVerifiedSession = vi.fn();
  const onConflict = vi.fn();
  const onRemoteMove = vi.fn();

  const view = renderHook(
    ({ current }: { current: ReturnType<typeof makeSession> }) =>
      useSupabaseRealtime({
        roomId: "room-1",
        localSession: current,
        onVerifiedSession,
        onConflict,
        onRemoteMove,
      }),
    { initialProps: props }
  );

  return {
    ...view,
    onVerifiedSession,
    onConflict,
    onRemoteMove,
    /** Swaps in the session the client would hold after acting locally. */
    setSession: (indices: readonly number[] | "initial") =>
      view.rerender({ current: makeSession(indices) }),
  };
}

/** Delivers a Realtime event to the handler the hook registered for it. */
function emit(table: string, event: string, next: Record<string, unknown>): void {
  const handler = [...handlers].reverse().find((h) => h.table === table && h.event === event);
  expect(handler, `no ${event} handler registered for ${table}`).toBeDefined();
  act(() => {
    handler?.callback({ new: next });
  });
}

beforeEach(() => {
  moveRows = [];
  roomRow = { id: "room-1", reset_epoch: 0 };
  queries = [];
  handlers = [];
  subscribed = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SEC-AUDIT-01: the client reads one epoch of the move log", () => {
  it("asks the server for the current epoch rather than every move in the room", async () => {
    // A room that has been reset once: five plies in epoch 0, one in epoch 1.
    roomRow = { id: "room-1", reset_epoch: 1 };
    moveRows = [
      ...FIRST_GAME.map((index, turn) =>
        moveRow({
          id: `old-${turn}`,
          epoch: 0,
          ply: turn + 1,
          player: turn % 2 === 0 ? "black" : "white",
          index,
        })
      ),
      moveRow({ id: "new-0", epoch: 1, ply: 1, player: "black", index: 8 }),
    ];

    const { onVerifiedSession, onConflict, result } = renderHookFor([8]);

    await waitFor(() => expect(result.current.isVerified).toBe(true));

    // The verification query is scoped to the epoch, not the room.
    const movesQuery = queries.find((query) => query.table === "game_moves");
    expect(movesQuery).toBeDefined();
    expect(movesQuery?.filters).toMatchObject({ room_id: "room-1", epoch: 1 });
    expect(movesQuery?.order).toBe("ply");

    // And the client adopts the new game's board, not a replay of both.
    expect(onConflict).not.toHaveBeenCalled();
    const adopted = onVerifiedSession.mock.calls.at(-1)?.[0];
    expect(adopted?.history).toHaveLength(1);
    expect(adopted?.history[0]?.id).toBe("new-0");
  });

  it("replays a room that has never been reset from epoch 0", async () => {
    roomRow = { id: "room-1", reset_epoch: 0 };
    moveRows = FIRST_GAME.map((index, turn) =>
      moveRow({
        id: `m-${turn}`,
        epoch: 0,
        ply: turn + 1,
        player: turn % 2 === 0 ? "black" : "white",
        index,
      })
    );

    const { result, onConflict } = renderHookFor(FIRST_GAME);

    await waitFor(() => expect(result.current.isVerified).toBe(true));
    expect(onConflict).not.toHaveBeenCalled();
    expect(queries.find((query) => query.table === "game_moves")?.filters).toMatchObject({ epoch: 0 });
  });

  it("treats a move from a superseded epoch as not present", async () => {
    roomRow = { id: "room-1", reset_epoch: 1 };
    moveRows = [
      moveRow({ id: "new-0", epoch: 1, ply: 1, player: "black", index: 8 }),
    ];

    const { result, onRemoteMove, onConflict } = renderHookFor([8]);
    await waitFor(() => expect(result.current.isVerified).toBe(true));

    // The subscription is filtered by room, so a move from the game that was
    // reset away still arrives. Applying it would corrupt the baseline.
    emit("game_moves", "INSERT", moveRow({ id: "ghost", epoch: 0, ply: 6, player: "black", index: 2 }));

    expect(onRemoteMove).not.toHaveBeenCalled();
    expect(onConflict).not.toHaveBeenCalled();
    expect(result.current.isVerified).toBe(true);

    // A move from the current epoch is still applied.
    emit("game_moves", "INSERT", moveRow({ id: "new-1", epoch: 1, ply: 2, player: "white", index: 1 }));
    expect(onRemoteMove).toHaveBeenCalledTimes(1);
    expect(onRemoteMove.mock.calls[0]?.[0]?.id).toBe("new-1");
  });

  it("drops the proven baseline when a reset advances the epoch", async () => {
    roomRow = { id: "room-1", reset_epoch: 0 };
    moveRows = FIRST_GAME.map((index, turn) =>
      moveRow({
        id: `m-${turn}`,
        epoch: 0,
        ply: turn + 1,
        player: turn % 2 === 0 ? "black" : "white",
        index,
      })
    );

    const { result, onRemoteMove, setSession } = renderHookFor(FIRST_GAME);
    await waitFor(() => expect(result.current.isVerified).toBe(true));

    // A reset starts a new game from the opening position, so the client
    // acting on it now holds an empty board and the new log is empty too. The
    // five plies of the abandoned game are still on the server, in epoch 0.
    roomRow = { id: "room-1", reset_epoch: 1 };
    moveRows = [];
    setSession("initial");
    await waitFor(() => expect(queries.filter((q) => q.table === "game_moves").length).toBeGreaterThan(0));

    emit("game_rooms", "UPDATE", {
      id: "room-1",
      version: 9,
      status: "active",
      current_turn: "black",
      turn_number: 1,
      board_snapshot: makeSession("initial").boardSnapshot,
      winner: null,
      reset_epoch: 1,
      player_white_token: "white-token",
    });

    // The baseline claimed ply 5 of a game that is now over. It has to be
    // dropped the moment the epoch moves, not left standing until the
    // re-verification finishes: ply numbering restarts at 1 in the new epoch,
    // and against a stale `ply 5` the new game's opening moves all compare as
    // "already replayed" and are discarded with no error raised anywhere.
    expect(result.current.isVerified).toBe(false);

    await waitFor(() => expect(result.current.isVerified).toBe(true));

    // The first move of the new game is applied rather than swallowed.
    emit("game_moves", "INSERT", moveRow({ id: "new-0", epoch: 1, ply: 1, player: "black", index: 8 }));
    expect(onRemoteMove.mock.calls.map((call) => call[0]?.id)).toContain("new-0");
  });

  it("re-verifies against the new epoch and ignores the abandoned game's plies", async () => {
    roomRow = { id: "room-1", reset_epoch: 0 };
    moveRows = FIRST_GAME.map((index, turn) =>
      moveRow({
        id: `m-${turn}`,
        epoch: 0,
        ply: turn + 1,
        player: turn % 2 === 0 ? "black" : "white",
        index,
      })
    );

    const { result, onVerifiedSession, setSession } = renderHookFor(FIRST_GAME);
    await waitFor(() => expect(result.current.isVerified).toBe(true));

    roomRow = { id: "room-1", reset_epoch: 1 };
    moveRows = [];
    setSession("initial");
    emit("game_rooms", "UPDATE", {
      id: "room-1",
      version: 9,
      status: "active",
      current_turn: "black",
      turn_number: 1,
      board_snapshot: makeSession("initial").boardSnapshot,
      winner: null,
      reset_epoch: 1,
      player_white_token: "white-token",
    });

    await waitFor(() => expect(result.current.isVerified).toBe(true));

    // The query the re-verification issued was for the new epoch, and the
    // session it adopted came back empty — the abandoned game's plies are on
    // the server but no longer part of this game.
    const last = queries.filter((query) => query.table === "game_moves").at(-1);
    expect(last?.filters).toMatchObject({ epoch: 1 });
    expect(onVerifiedSession.mock.calls.at(-1)?.[0]?.history).toEqual([]);
  });

  it("reads a room written before the epoch column existed as epoch 0", async () => {
    // `reset_epoch` is `not null` with a default, so a migrated database always
    // has it. A row that somehow lacks it must not be read as "no moves".
    roomRow = { id: "room-1" };
    moveRows = FIRST_GAME.map((index, turn) =>
      moveRow({
        id: `m-${turn}`,
        epoch: 0,
        ply: turn + 1,
        player: turn % 2 === 0 ? "black" : "white",
        index,
      })
    );

    const { result, onConflict } = renderHookFor(FIRST_GAME);

    await waitFor(() => expect(result.current.isVerified).toBe(true));
    expect(onConflict).not.toHaveBeenCalled();
    expect(queries.find((query) => query.table === "game_moves")?.filters).toMatchObject({ epoch: 0 });
  });
});
