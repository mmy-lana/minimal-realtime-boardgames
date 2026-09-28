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
/** The `game_rooms` row `.select().eq().single()` resolves to, per room. */
const rows = new Map<string, unknown>();
let readError: { code: string; message: string } | null = null;

/** jsdom reports `true` for `navigator.onLine`, so connectivity is set explicitly. */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
}

function resetFake(): void {
  setOnline(true);
  rpcResults.clear();
  rpcCalls.length = 0;
  tableCalls.length = 0;
  rows.clear();
  readError = null;
}

function scriptedOk(fn: string, data: unknown): void {
  rpcResults.set(fn, { data });
}

function scriptedError(fn: string, code: string, message: string): void {
  rpcResults.set(fn, { error: { code, message } });
}

/**
 * Scripts the shape the SECURITY DEFINER RPCs actually return.
 *
 * The distinction is not cosmetic. `submit_turn_move` resolves with
 * `error: null` and the outcome code sitting in `data`, because a
 * `version_conflict` is a *successful* call that reports a lost race. A fake
 * that puts the code in `error` takes the client's throw path instead, which
 * bumps `retryCount` without ever reaching the backoff, the version adoption,
 * or the abandon decision — leaving the entire conflict ladder untested.
 */
function scriptedCode(fn: string, code: string): void {
  rpcResults.set(fn, { data: code, error: undefined });
}

vi.mock("@supabase/supabase-js", () => {
  const chainable = () => {
    const api = {
      select: (columns?: string) => {
        tableCalls.push({ op: "select", args: { columns } });
        return api;
      },
      eq: (column: string, value: unknown) => {
        tableCalls.push({ op: "eq", args: { column, value } });
        return api;
      },
      single: () => {
        const eq = [...tableCalls].reverse().find((call) => call.op === "eq");
        const key = String(eq?.args.value ?? "");
        return Promise.resolve(
          readError !== null
            ? { data: null, error: readError }
            : { data: rows.get(key) ?? null, error: null }
        );
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
const {
  CONFLICT_BACKOFF_BASE_MS,
  SYNC_MAX_ATTEMPTS,
  adoptRemoteRoomState,
  conflictBackoffMs,
  createSyncQueueItem,
  dispatchMoveMutation,
  flushSyncQueue,
  isTransientConflictCode,
  isNetworkError,
} = await import("@/lib/sync");
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

describe("conflict backoff", () => {
  /**
   * Wall-clock, not fake timers.
   *
   * The whole point of the pause is that the two clients converge through the
   * same path *after a real delay*. A fake clock would prove the ladder calls
   * `sleep` with a number; only a real clock proves the number is the delay
   * that actually elapses, which is the property the Realtime race depends on.
   * The sleeps are therefore real, and the tests that need them are kept to
   * one or two retries so the suite still runs in about a second.
   */
  function elapsed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const started = Date.now();
    return run().then((value) => ({ value, ms: Date.now() - started }));
  }

  it("waits the base backoff before spending a retry", async () => {
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    // A lost race reported in `data` — the shape the server actually sends.
    scriptedCode("submit_turn_move", "version_conflict");

    const { value: summary, ms } = await elapsed(() => flushSyncQueue());

    expect(summary.conflictDetected).toBe(false);
    expect(summary.succeeded).toBe(0);
    expect(ms, "one retry must cost at least the base backoff").toBeGreaterThanOrEqual(
      CONFLICT_BACKOFF_BASE_MS
    );
    // Generous, but not unbounded: the pause is a pause, not a hang.
    expect(ms).toBeLessThan(2000);
    expect((await getLocalDb().syncQueue.get("queue-1"))?.retryCount).toBe(1);
  });

  it("doubles the pause on each further collision, measured end to end", async () => {
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    scriptedCode("submit_turn_move", "version_conflict");

    // First collision: 300ms. Second: 600ms. Together 900ms, which is more
    // than the sum of the two floors would allow a test to pass by luck if the
    // ladder were flat at 300ms.
    const first = await elapsed(() => flushSyncQueue());
    const second = await elapsed(() => flushSyncQueue());
    expect(first.ms).toBeGreaterThanOrEqual(CONFLICT_BACKOFF_BASE_MS);
    expect(second.ms).toBeGreaterThan(CONFLICT_BACKOFF_BASE_MS * 2);
  });

  it("doubles, floors at the base, and never runs away with itself", () => {
    expect(conflictBackoffMs(0)).toBe(300);
    expect(conflictBackoffMs(1)).toBe(600);
    expect(conflictBackoffMs(2)).toBe(1200);
    // Anything the queue could not produce is clamped to the floor rather than
    // trusted: a negative or NaN retry count must not become a zero wait.
    expect(conflictBackoffMs(-5)).toBe(300);
    expect(conflictBackoffMs(Number.NaN)).toBe(300);
    // And the ladder is capped, so a pathological count cannot produce a wait
    // long enough to look like a hung client.
    expect(conflictBackoffMs(1000)).toBe(conflictBackoffMs(8));
  });

  it("sends the retry with the version it just adopted, not the rejected one", async () => {
    // The defect this replaces: the retry re-sent the version the server had
    // already refused, so it could only ever fail the same way. The sleep is
    // there to let the incoming Realtime event settle; adopting the row before
    // sleeping is what makes the attempt that follows worth making.
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    rows.set(session.id, { version: 9, status: "active" });
    scriptedCode("submit_turn_move", "version_conflict");

    await flushSyncQueue();
    // The local row has moved on, and the rest of the session has not.
    const stored = await getLocalDb().games.get(session.id);
    expect(stored?.version).toBe(9);
    expect(stored?.history).toEqual([]);
    expect(stored?.boardSnapshot).toEqual(session.boardSnapshot);

    // Now the second attempt, which succeeds.
    scriptedCode("submit_turn_move", "success");
    await flushSyncQueue();
    const submitted = rpcCalls.filter((call) => call.fn === "submit_turn_move");
    expect(submitted).toHaveLength(2);
    expect(submitted[0]?.args.p_expected_version).toBe(1);
    expect(submitted[1]?.args.p_expected_version).toBe(9);
    expect((await getLocalDb().syncQueue.count())).toBe(0);
  });

  it("adopts nothing when the room cannot be read, and still retries", async () => {
    // A failed read must not be turned into a guess. The retry then behaves
    // exactly as it did before adoption existed — which is worse, but correct
    // — instead of stamping a made-up version onto the room.
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    readError = { code: "PGRST116", message: "no rows" };
    scriptedCode("submit_turn_move", "version_conflict");

    await flushSyncQueue();

    expect((await getLocalDb().games.get(session.id))?.version).toBe(1);
    expect((await getLocalDb().syncQueue.get("queue-1"))?.retryCount).toBe(1);

    // The second attempt was still sent, and still carrying the old version.
    scriptedCode("submit_turn_move", "success");
    await flushSyncQueue();
    const submitted = rpcCalls.filter((call) => call.fn === "submit_turn_move");
    expect(submitted).toHaveLength(2);
    expect(submitted[1]?.args.p_expected_version).toBe(1);
  });

  it("refuses a version it cannot use rather than adopting nonsense", async () => {
    for (const version of [0, -1, "9", null, Number.NaN]) {
      await getLocalDb().games.clear();
      const session = realtimeSession();
      await putSession(session);
      rows.set(session.id, { version, status: "active" });

      const adopted = await adoptRemoteRoomState({} as never, session.id);

      expect(adopted, `version ${String(version)}`).toBe(false);
      expect((await getLocalDb().games.get(session.id))?.version).toBe(1);
    }
  });

  it("does not adopt a version for a room this client has never seen", async () => {
    // The write is guarded by the local row existing, so a read that resolves
    // for a room absent from this device cannot create one.
    rows.set("stranger", { version: 42, status: "active" });
    const adopted = await adoptRemoteRoomState({} as never, "stranger");
    expect(adopted).toBe(false);
    expect(await getLocalDb().games.get("stranger")).toBeUndefined();
  });

  it("gives up on the ladder rather than retrying forever", async () => {
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    rows.set(session.id, { version: 9, status: "active" });
    scriptedCode("submit_turn_move", "version_conflict");

    // Two sleeps, then the third attempt is refused before it is even issued.
    await flushSyncQueue();
    await flushSyncQueue();
    const summary = await flushSyncQueue();

    expect(summary.conflictDetected).toBe(true);
    // The ladder is three *attempts* and two *pauses*: the third call is
    // issued, answered with a conflict, and abandoned rather than slept on.
    // A ladder without a ceiling would still be waiting here.
    expect(rpcCalls.filter((call) => call.fn === "submit_turn_move")).toHaveLength(
      SYNC_MAX_ATTEMPTS
    );
    expect((await getLocalDb().games.get(session.id))?.syncState).toBe("conflict");
  });

  it("abandons a refusal that no amount of waiting could fix", async () => {
    // The same `data`-shaped transport, opposite meaning. `unauthorized` will
    // be true on the fourth attempt exactly as it was on the first, so there is
    // no backoff to spend on it.
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    scriptedCode("submit_turn_move", "unauthorized");

    const { value: summary, ms } = await elapsed(() => flushSyncQueue());

    expect(summary.conflictDetected).toBe(true);
    expect(ms).toBeLessThan(CONFLICT_BACKOFF_BASE_MS);
    expect(rpcCalls.filter((call) => call.fn === "submit_turn_move")).toHaveLength(1);
    expect(await getLocalDb().syncQueue.count()).toBe(0);
  });

  it("treats a code it does not recognise as a hard failure", async () => {
    // An unrecognised code is not a transient race and must not be retried
    // into a version conflict, which would tell the player their move was lost
    // for a reason nobody can name.
    const session = realtimeSession();
    await putSession(session);
    await getLocalDb().syncQueue.put(moveItem(session.id, 1));
    rpcResults.set("submit_turn_move", { data: { surprise: true } });

    const summary = await flushSyncQueue();

    expect(summary.error).toContain("unrecognised result");
    // Abandoned on the first response, and said so — not retried into a board
    // conflict, which would blame the opponent's move for a reply this client
    // could not parse.
    expect(summary.conflictDetected).toBe(true);
    expect(rpcCalls.filter((call) => call.fn === "submit_turn_move")).toHaveLength(1);
    expect(await getLocalDb().syncQueue.count()).toBe(0);
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
