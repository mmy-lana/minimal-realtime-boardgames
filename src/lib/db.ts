import Dexie, { type Table } from "dexie";
import { GameSession, SyncQueueItem } from "@/engine/types";

export class MinimalBoardGamesDB extends Dexie {
  games!: Table<GameSession, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor() {
    super("minimal_board_games_db");
    this.version(1).stores({
      games: "id, gameKind, mode, status, updatedAt, syncState",
      syncQueue: "id, gameId, timestamp, retryCount",
    });
  }
}

export const localDb = new MinimalBoardGamesDB();
