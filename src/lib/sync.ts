/**
 * Section 3.2 — Offline-first sync & mutation queue.
 *
 * Every mutation follows a write-through path:
 *
 *   1. The new session snapshot and its `SyncQueueItem` are committed to
 *      IndexedDB in a single Dexie transaction, so the UI updates instantly
 *      and survives a reload whether or not the network is available.
 *   2. If the session is `online_realtime` and the browser reports a live
 *      connection, the queue is drained immediately.
 *   3. The drain is strictly FIFO and re-entrant-safe; it retries transient
 *      failures with an attempt counter and gives up into an explicit
 *      `conflict` sync state rather than silently discarding a move.
 *
 * All room mutations go through SECURITY DEFINER RPCs because
 * `public.game_rooms` intentionally has no client-side UPDATE policy.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { decodeMovePayload, type GameSession, type MoveRecord, type PlayerColor } from "@/engine/types";
import type { SyncQueueAction, SyncQueueItem } from "@/engine/types";

import { getLocalDb, isLocalDbAvailable } from "./db";
import { getSupabaseClient, getSupabaseConfigError } from "./supabase";

/** Attempts before a non-network failure is dropped and flagged as a conflict. */
export const SYNC_MAX_ATTEMPTS = 3;

/* -------------------------------------------------------------------------- */
/* RPC result contracts                                                       */
/* -------------------------------------------------------------------------- */

export const SUBMIT_TURN_MOVE_CODES = [
  "success",
  "room_not_found",
  "room_inactive",
  "version_conflict",
  "unauthorized",
] as const;
export type SubmitTurnMoveCode = (typeof SUBMIT_TURN_MOVE_CODES)[number];

export const JOIN_ROOM_CODES = [
  "seated_black",
  "seated_white",
  "room_not_found",
  "room_closed",
  "room_full",
] as const;
export type JoinRoomCode = (typeof JOIN_ROOM_CODES)[number];

export const SUBMIT_TERMINAL_UPDATE_CODES = [
  "success",
  "room_not_found",
  "version_conflict",
  "unauthorized",
  "invalid_status",
] as const;
export type SubmitTerminalUpdateCode = (typeof SUBMIT_TERMINAL_UPDATE_CODES)[number];

/** Narrows an untyped `supabase.rpc` payload to one of the declared codes. */
function asRpcCode<T extends string>(
  data: unknown,
  allowed: readonly T[]
): T | null {
  if (typeof data !== "string") return null;
  return (allowed as readonly string[]).includes(data) ? (data as T) : null;
}

/** `true` when the code reports a seated success. */
export function isJoinSuccess(code: JoinRoomCode): boolean {
  return code === "seated_black" || code === "seated_white";
}

/** `true` when the code represents a transient, retryable OCC collision. */
export function isTransientConflictCode(code: string): boolean {
  return code === "version_conflict";
}

/* -------------------------------------------------------------------------- */
/* Error classification                                                       */
/* -------------------------------------------------------------------------- */

/** HTTP statuses that indicate a transport-level problem, not a bad request. */
const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([
  0, 408, 425, 429, 500, 502, 503, 504,
]);

const NETWORK_ERROR_NAMES: ReadonlySet<string> = new Set([
  "NetworkError",
  "TimeoutError",
]);

/**
 * Classifies a thrown value as a connectivity failure.
 *
 * A network error must never increment `retryCount` and must never drop a
 * queued item: the queue is preserved verbatim and the drain stops until
 * connectivity returns.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof window !== "undefined" && !navigator.onLine) return true;

  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    if (
      message.includes("fetch") ||
      message.includes("network") ||
      message.includes("failed to load")
    ) {
      return true;
    }
  }

  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    NETWORK_ERROR_NAMES.has(error.name)
  ) {
    return true;
  }

  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && TRANSIENT_HTTP_STATUSES.has(status)) {
      return true;
    }
  }

  return false;
}

/** `true` when the browser is known to be offline. */
export function isBrowserOffline(): boolean {
  return typeof window !== "undefined" && !navigator.onLine;
}

/* -------------------------------------------------------------------------- */
/* Flush summary                                                              */
/* -------------------------------------------------------------------------- */

export interface FlushSummary {
  /** Queue items inspected during this drain. */
  attempted: number;
  /** Items acknowledged by the backend and removed from the queue. */
  succeeded: number;
  /** Items removed without server acknowledgement (terminal failure). */
  dropped: number;
  /** Items left queued for a later attempt. */
  pending: number;
  /** `true` when the drain stopped early because the network went away. */
  blockedByNetwork: boolean;
  /** `true` when at least one session was flagged `conflict` by this drain. */
  conflictDetected: boolean;
  /** Present when the drain could not run at all (e.g. no local storage). */
  error: string | null;
}

function emptySummary(error: string | null = null): FlushSummary {
  return {
    attempted: 0,
    succeeded: 0,
    dropped: 0,
    pending: 0,
    blockedByNetwork: false,
    conflictDetected: false,
    error,
  };
}

/* -------------------------------------------------------------------------- */
/* Mutation dispatch                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Commits a session mutation to IndexedDB and, for realtime sessions, attempts
 * an immediate drain.
 *
 * The session's `syncState` is derived here rather than trusted from the
 * caller: a realtime session that is not already in `conflict` is marked
 * `pending_upload` so the UI can never report "synced" while an item is still
 * queued.
 */
export async function dispatchMoveMutation(
  session: GameSession,
  mutationPayload: SyncQueueItem
): Promise<FlushSummary> {
  if (!session.id) {
    throw new TypeError("dispatchMoveMutation: session.id must be a non-empty string");
  }
  if (mutationPayload.gameId !== session.id) {
    throw new TypeError(
      `dispatchMoveMutation: queue item gameId "${mutationPayload.gameId}" does not match session "${session.id}"`
    );
  }

  const db = getLocalDb();
  const isRealtime = session.mode === "online_realtime";
  const sessionToPersist: GameSession = isRealtime
    ? { ...session, syncState: session.syncState === "conflict" ? "conflict" : "pending_upload" }
    : session;

  await db.transaction("rw", db.games, db.syncQueue, async () => {
    await db.games.put(sessionToPersist);
    if (isRealtime) {
      await db.syncQueue.put(mutationPayload);
    }
  });

  if (!isRealtime) return emptySummary();
  return flushSyncQueue();
}

/** Creates the queue item for a session-local mutation. */
export function createSyncQueueItem(
  gameId: string,
  action: SyncQueueAction,
  payload: SyncQueueItem["payload"],
  id: string,
  actor?: PlayerColor,
  timestamp: number = Date.now()
): SyncQueueItem {
  return { id, gameId, action, payload, timestamp, retryCount: 0, actor };
}

/* -------------------------------------------------------------------------- */
/* Queue drain                                                                */
/* -------------------------------------------------------------------------- */

let inFlightFlush: Promise<FlushSummary> | null = null;

/**
 * Drains the sync queue in FIFO order.
 *
 * Re-entrant calls join the in-flight drain rather than starting a second one,
 * so a burst of moves can never double-send a ply.
 */
export function flushSyncQueue(): Promise<FlushSummary> {
  if (inFlightFlush !== null) return inFlightFlush;
  const run = drainSyncQueue()
    .catch((error: unknown): FlushSummary => {
      const message = error instanceof Error ? error.message : String(error);
      return emptySummary(message);
    })
    .finally(() => {
      inFlightFlush = null;
    });
  inFlightFlush = run;
  return run;
}

type ItemOutcome =
  /** Server acknowledged the item; remove it from the queue. */
  | { kind: "acknowledge" }
  /** Keep the item and retry it on a later drain. */
  | { kind: "retry" }
  /**
   * Remove the item and any newer items for the same game: the remaining tail
   * was computed against a board that is no longer authoritative.
   */
  | { kind: "abandon" };
// A connectivity failure is not modelled here: it is thrown by the Supabase
// client and caught by the drain loop, which stops without touching any item.

async function drainSyncQueue(): Promise<FlushSummary> {
  if (!isLocalDbAvailable()) {
    return emptySummary(
      "IndexedDB is unavailable, so the local mutation queue cannot be drained."
    );
  }

  const db = getLocalDb();

  const configError = getSupabaseConfigError();
  if (configError !== null) {
    const pending = await db.syncQueue.count();
    return { ...emptySummary(configError), pending };
  }

  if (isBrowserOffline()) {
    const pending = await db.syncQueue.count();
    return { ...emptySummary(null), pending, blockedByNetwork: true };
  }

  const supabase = getSupabaseClient();
  const pendingItems = await db.syncQueue.orderBy("timestamp").toArray();
  const summary = emptySummary();
  summary.attempted = pendingItems.length;

  for (const item of pendingItems) {
    const session = await db.games.get(item.gameId);

    if (!session || session.mode !== "online_realtime") {
      // The owning session is gone or was never realtime: the queued item can
      // never become valid, so drop it instead of blocking the queue head.
      await db.syncQueue.delete(item.id);
      summary.dropped += 1;
      continue;
    }

    let outcome: ItemOutcome;
    try {
      outcome = await runQueueItem(supabase, item, session);
    } catch (error: unknown) {
      if (isNetworkError(error)) {
        summary.blockedByNetwork = true;
        break;
      }

      const nextAttempt = item.retryCount + 1;
      if (nextAttempt >= SYNC_MAX_ATTEMPTS) {
        await markConflictAndAbandonTail(db, item);
        summary.dropped += 1;
        summary.conflictDetected = true;
      } else {
        await db.syncQueue.update(item.id, { retryCount: nextAttempt });
      }
      continue;
    }

    if (outcome.kind === "retry") {
      await db.syncQueue.update(item.id, {
        retryCount: item.retryCount + 1,
      });
      continue;
    }

    if (outcome.kind === "abandon") {
      await markConflictAndAbandonTail(db, item);
      summary.dropped += 1;
      summary.conflictDetected = true;
      continue;
    }

    await db.syncQueue.delete(item.id);
    summary.succeeded += 1;
  }

  summary.pending = await db.syncQueue.count();
  return summary;
}

/**
 * Flags the owning session as conflicted and removes the offending item plus
 * every later item for the same game, which can no longer be trusted because
 * they were derived from a rejected board.
 */
async function markConflictAndAbandonTail(
  db: ReturnType<typeof getLocalDb>,
  item: SyncQueueItem
): Promise<void> {
  await db.games.update(item.gameId, { syncState: "conflict" });
  await db.syncQueue.delete(item.id);

  const remaining = await db.syncQueue
    .where("gameId")
    .equals(item.gameId)
    .toArray();
  const stale = remaining
    .filter((entry) => entry.timestamp >= item.timestamp)
    .map((entry) => entry.id);
  if (stale.length > 0) {
    await db.syncQueue.bulkDelete(stale);
  }
}

async function runQueueItem(
  supabase: SupabaseClient,
  item: SyncQueueItem,
  session: GameSession
): Promise<ItemOutcome> {
  switch (item.action) {
    case "CREATE":
      return runCreateItem(supabase, session);
    case "MOVE":
      return runMoveItem(supabase, item, session);
    case "RESIGN":
    case "RESET":
      return runTerminalItem(supabase, item, session);
    default: {
      const exhaustive: never = item.action;
      throw new TypeError(`Unsupported sync action: ${String(exhaustive)}`);
    }
  }
}

/** CREATE — publish a new waiting room. Idempotent on `id`. */
async function runCreateItem(
  supabase: SupabaseClient,
  session: GameSession
): Promise<ItemOutcome> {
  const { error } = await supabase.from("game_rooms").upsert(
    {
      id: session.id,
      game_kind: session.gameKind,
      status: session.status,
      player_black_token: session.playerBlackToken,
      player_white_token: session.playerWhiteToken,
      current_turn: session.currentTurn,
      turn_number: session.turnNumber,
      board_snapshot: session.boardSnapshot,
      winner: session.winner,
      version: session.version,
      created_at: new Date(session.createdAt).toISOString(),
      updated_at: new Date(session.updatedAt).toISOString(),
    },
    { onConflict: "id", ignoreDuplicates: true }
  );

  if (error) throw error;

  if (session.syncState !== "conflict") {
    await getLocalDb().games.update(session.id, { syncState: "synced" });
  }
  return { kind: "acknowledge" };
}

/** MOVE — submit one ply through the OCC-locked RPC. */
async function runMoveItem(
  supabase: SupabaseClient,
  item: SyncQueueItem,
  session: GameSession
): Promise<ItemOutcome> {
  const move = item.payload as MoveRecord;
  const playerToken = seatTokenFor(session, move.player);

  if (!playerToken) {
    throw new Error(
      "Missing seated player token for authorized move execution"
    );
  }

  const { data, error } = await supabase.rpc("submit_turn_move", {
    p_room_id: session.id,
    p_player_token: playerToken,
    p_expected_version: session.version,
    p_move_id: move.id,
    p_ply: move.ply,
    p_player: move.player,
    p_from_coord: move.from ?? null,
    p_to_coord: move.to,
    p_payload: move.payload ?? null,
    p_board_snapshot: session.boardSnapshot,
    p_winner: session.winner,
    p_status: session.status,
    // A Reversi pass leaves the mover on the move; the server has to know that
    // or it would hand the turn over and the room would deadlock.
    p_passes_turn: decodeMovePayload(move.payload).passesTurn,
  });

  if (error) throw error;

  const code = asRpcCode(data, SUBMIT_TURN_MOVE_CODES);
  if (code === null) {
    throw new Error(
      `submit_turn_move returned an unrecognised result: ${JSON.stringify(data)}`
    );
  }

  if (code === "success") {
    await getLocalDb().games.update(session.id, {
      syncState: session.syncState === "conflict" ? "conflict" : "synced",
      version: session.version + 1,
    });
    return { kind: "acknowledge" };
  }

  if (isTransientConflictCode(code) && item.retryCount + 1 < SYNC_MAX_ATTEMPTS) {
    return { kind: "retry" };
  }

  return { kind: "abandon" };
}

/**
 * RESIGN / RESET — terminal room updates.
 *
 * Routed through `submit_terminal_update` rather than a direct
 * `.update()`: `public.game_rooms` has no client-side UPDATE policy by design.
 */
async function runTerminalItem(
  supabase: SupabaseClient,
  item: SyncQueueItem,
  session: GameSession
): Promise<ItemOutcome> {
  // A `Partial<GameSession>` payload carries no actor, so the seat is taken
  // from the queue item. When it is absent (a queue written by an older
  // client), fall back to the seat the local client can actually hold: the
  // opponent's if it is seated, otherwise the creator's black seat.
  const actor: PlayerColor =
    item.actor ?? (session.playerWhiteToken !== null ? "white" : "black");
  const playerToken = seatTokenFor(session, actor);

  if (!playerToken) {
    throw new Error(
      `Missing seated "${actor}" player token for authorized terminal update execution`
    );
  }

  const { data, error } = await supabase.rpc("submit_terminal_update", {
    p_room_id: session.id,
    p_player_token: playerToken,
    p_expected_version: session.version,
    p_board_snapshot: session.boardSnapshot,
    p_current_turn: session.currentTurn,
    p_turn_number: session.turnNumber,
    p_winner: session.winner,
    p_status: session.status,
    p_clear_history: item.action === "RESET",
  });

  if (error) throw error;

  const code = asRpcCode(data, SUBMIT_TERMINAL_UPDATE_CODES);
  if (code === null) {
    throw new Error(
      `submit_terminal_update returned an unrecognised result: ${JSON.stringify(data)}`
    );
  }

  if (code === "success") {
    await getLocalDb().games.update(session.id, {
      syncState: session.syncState === "conflict" ? "conflict" : "synced",
      version: session.version + 1,
    });
    return { kind: "acknowledge" };
  }

  if (isTransientConflictCode(code) && item.retryCount + 1 < SYNC_MAX_ATTEMPTS) {
    return { kind: "retry" };
  }

  return { kind: "abandon" };
}

function seatTokenFor(
  session: GameSession,
  color: PlayerColor
): string | null {
  return color === "black" ? session.playerBlackToken : session.playerWhiteToken;
}

/* -------------------------------------------------------------------------- */
/* Room lifecycle                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Requests the opponent seat for a waiting room. Idempotent: re-joining with
 * the same token reports the seat already held.
 */
export async function joinRoom(
  roomId: string,
  playerToken: string
): Promise<JoinRoomCode> {
  const { data, error } = await getSupabaseClient().rpc("join_room", {
    p_room_id: roomId,
    p_player_token: playerToken,
  });

  if (error) throw error;

  const code = asRpcCode(data, JOIN_ROOM_CODES);
  if (code === null) {
    throw new Error(`join_room returned an unrecognised result: ${JSON.stringify(data)}`);
  }
  return code;
}
