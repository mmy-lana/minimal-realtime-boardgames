/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Section 4.3 — the write-through sync queue and the optimistic-concurrency
 * control path.
 *
 * These are the tests the queue has never had, and they run against a real
 * Dexie instance on `fake-indexeddb` rather than a stub, so the transaction
 * that writes the session and its queue item together is genuinely exercised.
 *
 * The Supabase client is the only substituted piece. It is a hand-written fake
 * that records every RPC and hands back a scripted result, because the code
 * under test is precisely the policy *around* the RPC — the retry ladder, the
 * abandon-tail rule, and the conflict flag — and none of that policy lives in
 * Supabase.
 */

const rpcResults = new Map<string, { data?: unknown; error?: { code: string; message: string } }>();
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const tableCalls: { op: string; args: Record<string, unknown> }[] = [];

/** jsdom reports `true` for `navigator.onLine`, so connectivity is set explicitly. */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
}

function resetFake(): void {
  setOnline(true);
  rpcResults.clear();
  rpcCalls.length = 0;
  tableCalls.length = 0;
}

function scriptedOk(fn: string, data: unknown): void {
  rpcResults.set(fn, { data });
}

function scriptedError(fn: string, code: string, message: string): void {
  rpcResults.set(fn, { error: { code, message } });
}

vi.mock("@supabase/supabase-js", () => {
  const chainable = () => {
    const api = {
      select: () => {
        tableCalls.push({ op: "select", args: {} });
        return api;
      },
      upsert: (payload: unknown) => {
        tableCalls.push({ op: "upsert", args: { payload } });
        return Promise.resolve({ data: null, error: null });
      },
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve(rpcResults.get(fn) ?? { data: null, error: null });
      },
    };
    return api;
  };

  return {
    createClient: () => ({ from: () => chainable(), rpc: chainable().rpc, channel: () => ({}) }),
  };
});

const { createGameSession } = await import("@/hooks/useGameSession");
const { getLocalDb, putSession } = await import("@/lib/db");
const { createSyncQueueItem, dispatchMoveMutation, flushSyncQueue, isTransientConflictCode, isNetworkError } =
  await import("@/lib/sync");
const { resetSupabaseClient } = await import("@/lib/supabase");

function realtimeSession(): ReturnType<typeof createGameSession> {
  return createGameSession({
    id: "room-1",
    gameKind: "tictactoe",
    mode: "online_realtime",
    playerBlackToken: "black-token",
    playerWhiteToken: "white-token",
    localSeat: "black",
  });
}

function moveItem(gameId: string, ply: number) {
  return createSyncQueueItem(
    gameId,
    "MOVE",
    {
      id: `m${ply}`,
      gameId,
      ply,
      player: "black" as const,
      to: { x: ply % 3, y: Math.floor(ply / 3) },
      timestamp: ply,
    },
    `queue-${ply}`,
    "black",
    ply
  );
}

beforeEach(() => {
  resetFake();
  resetSupabaseClient();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  return getLocalDb().transaction("rw", getLocalDb().games, getLocalDb().syncQueue, async () => {
    await getLocalDb().games.clear();
    await getLocalDb().syncQueue.clear();
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  resetSupabaseClient();
});

describe("dispatchMoveMutation", () => {
  it("writes an offline session to Dexie without queueing anything", async () => {
    const session = realtimeSession();
    const local = { ...session, mode: "offline_local" as const };
    await dispatchMoveMutation(local, moveItem(local.id, 1));

    const stored = await getLocalDb().games.get(local.id);
    expect(stored).toBeDefined();
    // Nothing leaves the device in local mode, so the queue must stay empty
    // even though a payload was supplied.
    expect(await getLocalDb().syncQueue.count()).toBe(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("marks a realtime session pending and drains it on the next tick", async () => {
    const session = realtimeSession();
    scriptedOk("submit_turn_move", "success");
    const summary = await dispatchMoveMutation(session, moveItem(session.id, 1));

    const stored = await getLocalDb().games.get(session.id);
    // The write is pending for the duration of the drain and settles to
    // `synced` once the server acknowledges it.
    expect(stored?.syncState).toBe("synced");
    expect(rpcCalls.map((call) => call.fn)).toEqual(["submit_turn_move"]);
    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.conflictDetected).toBe(false);
    expect(await getLocalDb().syncQueue.count()).toBe(0);
  });

  it("keeps the item queued when the browser is offline", async () => {
    const session = realtimeSession();
    setOnline(false);
    const summary = await dispatchMoveMutation(session, moveItem(session.id, 1));
    expect(summary.blockedByNetwork).toBe(true);
    expect(summary.succeeded).toBe(0);
    // Nothing may be discarded while the device is offline: the queue is the
    // only copy of the move until connectivity returns.
    expect(await getLocalDb().syncQueue.count()).toBe(1);
    const queued = await getLocalDb().syncQueue.get("queue-1");
    expect(queued?.retryCount).toBe(0);
  });

  it("sends a queued move once the device comes back online", async () => {
    const session = realtimeSession();
    setOnline(false);
    await dispatchMoveMutation(session, moveItem(session.id, 1));
    expect(await getLocalDb().syncQueue.count()).toBe(1);

    setOnline(true);
    scriptedOk("submit_turn_move", "success");
    const summary = await flushSyncQueue();

    expect(summary.succeeded).toBe(1);
    expect(await getLocalDb().syncQueue.count()).toBe(0);
    const stored = await getLocalDb().games.get(session.id);
    expect(stored?.syncState).toBe("synced");
    // The server acknowledged the move, so the local version counter advances
    // and the next OCC comparison uses the version the server now holds.
    expect(stored?.version).toBe(session.version + 1);
  });

  it("rejects a payload whose game id does not match the session", async () => {
    const session = realtimeSession();
    await expect(
      dispatchMoveMutation(session, moveItem("some-other-room", 1))
    ).rejects.toThrow(/does not match/);
  });

  it("rejects a session with no id", async () => {
    const session = { ...realtimeSession(), id: "" };
    await expect(dispatchMoveMutation(session, moveItem("", 1))).rejects.toThrow(/non-empty/);
  });
});

describe("optimistic concurrency control", () => {
  it("retries a transient conflict and keeps the item queued", async () => {
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    scriptedError("submit_turn_move", "version_conflict", "room moved on");

    const summary = await flushSyncQueue();

    expect(summary.conflictDetected).toBe(false);
    expect(summary.succeeded).toBe(0);
    const queued = await getLocalDb().syncQueue.get("queue-1");
    expect(queued?.retryCount).toBe(1);
  });

  it("flags a conflict and abandons the tail once retries are exhausted", async () => {
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.bulkPut([moveItem(session.id, 1), moveItem(session.id, 2)]);
    scriptedError("submit_turn_move", "version_conflict", "room moved on");

    // The ladder gives up on the third attempt, so the first two flushes only
    // ever bump `retryCount`.
    await flushSyncQueue();
    await flushSyncQueue();
    const summary = await flushSyncQueue();

    expect(summary.conflictDetected).toBe(true);
    // The offending item and every later item derived from the rejected board
    // must be gone, or the next drain would replay a move onto a board the
    // server has already moved past.
    expect(await getLocalDb().syncQueue.count()).toBe(0);
    const stored = await getLocalDb().games.get(session.id);
    expect(stored?.syncState).toBe("conflict");
  });

  it("drops a queued item whose owning session no longer exists", async () => {
    await getLocalDb().syncQueue.put(moveItem("ghost-room", 1));
    const summary = await flushSyncQueue();
    expect(summary.dropped).toBe(1);
    expect(await getLocalDb().syncQueue.count()).toBe(0);
  });

  it("drops a queued item belonging to a session that is not realtime", async () => {
    const local = { ...realtimeSession(), id: "local-1", mode: "offline_local" as const };
    await putSession(local);
    await getLocalDb().syncQueue.put(moveItem(local.id, 1));
    const summary = await flushSyncQueue();
    expect(summary.dropped).toBe(1);
    expect(await getLocalDb().syncQueue.count()).toBe(0);
  });

  it("does not mark a conflict when the session is already conflicted", async () => {
    const session = { ...realtimeSession(), syncState: "conflict" as const };
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    scriptedOk("submit_turn_move", "success");

    await flushSyncQueue();
    const stored = await getLocalDb().games.get(session.id);
    // A conflict is sticky: a later successful send must not quietly clear it
    // and hand the board back to a player who is out of step with the server.
    expect(stored?.syncState).not.toBe("synced");
  });
});

describe("error classification", () => {
  it("treats a version conflict as transient", () => {
    expect(isTransientConflictCode("version_conflict")).toBe(true);
  });

  it("does not treat a non-retriable rejection as transient", () => {
    // `unauthorized` will never succeed on a retry, so the queue must abandon
    // the tail immediately instead of burning the retry budget.
    expect(isTransientConflictCode("unauthorized")).toBe(false);
  });

  it("does not treat an unknown code as transient", () => {
    expect(isTransientConflictCode("something_else")).toBe(false);
  });

  it("reports every failure as a network error while the browser is offline", () => {
    setOnline(false);
    expect(isNetworkError(new Error("any failure at all"))).toBe(true);
    expect(isNetworkError(undefined)).toBe(true);
  });

  it("recognises a fetch failure by its error type", () => {
    setOnline(true);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new DOMException("The user aborted a request.", "NetworkError"))).toBe(
      true
    );
  });

  it("recognises a transport-level HTTP status", () => {
    setOnline(true);
    expect(isNetworkError(Object.assign(new Error("server exploded"), { status: 503 }))).toBe(true);
    expect(isNetworkError(Object.assign(new Error("bad request"), { status: 400 }))).toBe(false);
  });

  it("does not classify a plain application error as a network failure", () => {
    setOnline(true);
    expect(isNetworkError(new Error("The move is not allowed."))).toBe(false);
    expect(isNetworkError("not an error")).toBe(false);
  });
});
