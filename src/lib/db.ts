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

import type { GameKind, GameSession, SyncQueueItem } from "@/engine/types";

export const LOCAL_DB_NAME = "minimal_board_games_db";

/** Storage scheme version. Bump only together with a migration in `stores`. */
export const LOCAL_DB_SCHEMA_VERSION = 1;

export class MinimalBoardGamesDB extends Dexie {
  games!: Table<GameSession, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor(name: string = LOCAL_DB_NAME) {
    super(name);
    this.version(LOCAL_DB_SCHEMA_VERSION).stores({
      games: "id, gameKind, mode, status, updatedAt, syncState",
      syncQueue: "id, gameId, timestamp, retryCount",
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
