/**
 * Section 1.2 — Local database (Dexie / IndexedDB).
 *
 * The local database is the source of truth for the offline-first client:
 * every mutation is written here first (write-through) and only then
 * forwarded to Supabase by `lib/sync.ts`. Reactive components read from these
 * tables through `useLiveQuery` from `dexie-react-hooks`.
 *
 * Constructing a Dexie instance never opens a connection, so the module can be
 * imported from server components; all *reads and writes* must go through
 * {@link getLocalDb}, which refuses to run where IndexedDB is unavailable.
 */

import Dexie, { type Table } from "dexie";

import { isGameKind } from "@/engine/types";
import type { GameKind, GameSession, SyncQueueItem } from "@/engine/types";

export const LOCAL_DB_NAME = "minimal_board_games_db";

/**
 * Storage scheme version.
 *
 * Bump this together with a migration: either a `stores` change to the schema,
 * or an `upgrade` hook to the data. Version 2 added the `upgrade` hook below,
 * which prunes rows a later build can no longer interpret.
 *
 * The version must be declared as an explicit literal, not derived from
 * `LOCAL_DB_SCHEMA_VERSION`: a migration that reads its own version number
 * would silently skip the work it was written to do.
 */
export const LOCAL_DB_SCHEMA_VERSION = 2;

export class MinimalBoardGamesDB extends Dexie {
  games!: Table<GameSession, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor(name: string = LOCAL_DB_NAME) {
    super(name);

    // v1 — the original schema, kept verbatim. Dexie needs the full history of
    // version declarations to open a database that was written by an older
    // build, so this block may never be edited or removed.
    this.version(1).stores({
      games: "id, gameKind, mode, status, updatedAt, syncState",
      syncQueue: "id, gameId, timestamp, retryCount",
    });

    // v2 — same stores, plus a data migration.
    //
    // The `chess` -> `hex` rename left rows behind whose `gameKind` is no
    // longer in the catalog. Those rows were not merely stale: rendering one
    // dereferenced a missing metadata entry and threw, which unmounted the
    // whole page. Pruning them at upgrade time removes the cause rather than
    // relying on every reader to survive it.
    this.version(2)
      .stores({
        games: "id, gameKind, mode, status, updatedAt, syncState",
        syncQueue: "id, gameId, timestamp, retryCount",
      })
      .upgrade(async (tx) => {
        const games = tx.table<GameSession, string>("games");
        const syncQueue = tx.table<SyncQueueItem, string>("syncQueue");

        // 1. Drop sessions whose kind this build cannot play.
        //
        // `game?.gameKind` rather than `game.gameKind`: the declared row type
        // is an assumption, and a database written by a build that crashed
        // mid-write can hold something that is not an object at all.
        const staleGameKeys = await games
          .toCollection()
          .filter((game) => !isGameKind(game?.gameKind))
          .primaryKeys();
        if (staleGameKeys.length > 0) await games.bulkDelete(staleGameKeys);

        // 2. Drop queued writes that no longer belong to a live session.
        //
        // Deliberately resolved through `gameId` rather than by inspecting the
        // payload. A `MoveRecord` payload has no `gameKind` field at all, so
        // testing the payload would classify every pending move as stale and
        // discard moves the player has made but not yet uploaded. Every queued
        // item belongs to a session in `games`, and step 1 has already removed
        // the unplayable ones, so an item is meaningless exactly when its
        // owning session is gone.
        const liveGameIds = new Set((await games.toArray()).map((game) => game.id));
        const staleQueueKeys = await syncQueue
          .toCollection()
          .filter((item) => !item || typeof item.gameId !== "string" || !liveGameIds.has(item.gameId))
          .primaryKeys();
        if (staleQueueKeys.length > 0) await syncQueue.bulkDelete(staleQueueKeys);
      });
  }
}

/**
 * Process-wide singleton. Declared eagerly so the schema is registered at
 * import time, but never queried during server rendering.
 */
export const localDb = new MinimalBoardGamesDB();

/** Raised when local persistence is required but IndexedDB is not usable. */
export class LocalDatabaseUnavailableError extends Error {
  override readonly name = "LocalDatabaseUnavailableError";

  constructor(message?: string) {
    super(
      message ??
        "IndexedDB is not available in this environment. Local board-game sessions require a browser context with persistent storage enabled."
    );
  }
}

/**
 * `true` only when the current runtime can actually open an IndexedDB
 * database (i.e. a browser tab, not a server render or a worker-less shell).
 */
export function isLocalDbAvailable(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof indexedDB === "undefined" || indexedDB === null) return false;
  return typeof IDBKeyRange !== "undefined" && IDBKeyRange !== null;
}

/** Returns the singleton, or throws a descriptive error when unsupported. */
export function getLocalDb(): MinimalBoardGamesDB {
  if (!isLocalDbAvailable()) {
    throw new LocalDatabaseUnavailableError();
  }
  return localDb;
}

/* -------------------------------------------------------------------------- */
/* Repository helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Query helper that converts a missing-IndexedDB environment into `null`
 * instead of an exception, for components that must still render an
 * explicit empty state (for example a game library during SSR).
 */
async function tryQuery<T>(query: () => Promise<T>, fallback: T): Promise<T> {
  if (!isLocalDbAvailable()) return fallback;
  return query();
}

export function getSessionById(id: string): Promise<GameSession | undefined> {
  return tryQuery(() => getLocalDb().games.get(id), undefined);
}

export function putSession(session: GameSession): Promise<string> {
  return getLocalDb().games.put(session);
}

/** Persists several sessions atomically (used by replay and import paths). */
export function putSessions(sessions: readonly GameSession[]): Promise<string> {
  return getLocalDb().games.bulkPut(sessions as GameSession[]);
}

export function listSessionsByRecentActivity(): Promise<GameSession[]> {
  return tryQuery(
    () => getLocalDb().games.orderBy("updatedAt").reverse().toArray(),
    []
  );
}

export function listSessionsByKind(gameKind: GameKind): Promise<GameSession[]> {
  return tryQuery(
    () => getLocalDb().games.where("gameKind").equals(gameKind).toArray(),
    []
  );
}

export function deleteSessionById(id: string): Promise<void> {
  return getLocalDb().transaction(
    "rw",
    getLocalDb().games,
    getLocalDb().syncQueue,
    async () => {
      await getLocalDb().games.delete(id);
      await getLocalDb().syncQueue.where("gameId").equals(id).delete();
    }
  );
}

/** Queue items in FIFO drain order — the order the sync queue must honour. */
export function listPendingSyncItems(): Promise<SyncQueueItem[]> {
  return tryQuery(
    () => getLocalDb().syncQueue.orderBy("timestamp").toArray(),
    []
  );
}

export function countPendingSyncItems(): Promise<number> {
  return tryQuery(() => getLocalDb().syncQueue.count(), 0);
}

export function enqueueSyncItem(item: SyncQueueItem): Promise<string> {
  return getLocalDb().syncQueue.put(item);
}
