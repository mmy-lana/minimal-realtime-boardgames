import { supabase } from "./supabase";
import { localDb } from "./db";
import { GameSession, MoveRecord, SyncQueueItem } from "@/engine/types";

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes("fetch")) return true;
  if (typeof window !== "undefined" && !navigator.onLine) return true;
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: number }).status;
    return status === 0 || status === 502 || status === 503 || status === 504;
  }
  return false;
}

export async function dispatchMoveMutation(
  session: GameSession,
  mutationPayload: SyncQueueItem
): Promise<void> {
  await localDb.transaction("rw", localDb.games, localDb.syncQueue, async () => {
    await localDb.games.put(session);
    if (session.mode === "online_realtime") {
      await localDb.syncQueue.put(mutationPayload);
    }
  });

  if (typeof window !== "undefined" && navigator.onLine && session.mode === "online_realtime") {
    await flushSyncQueue();
  }
}

export async function flushSyncQueue(): Promise<void> {
  const pendingItems = await localDb.syncQueue.orderBy("timestamp").toArray();
  if (pendingItems.length === 0) return;

  for (const item of pendingItems) {
    try {
      const session = await localDb.games.get(item.gameId);
      if (!session) {
        await localDb.syncQueue.delete(item.id);
        continue;
      }

      switch (item.action) {
        case "CREATE": {
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
          break;
        }

        case "MOVE": {
          const moveData = item.payload as MoveRecord;
          const playerToken =
            moveData.player === "black" ? session.playerBlackToken : session.playerWhiteToken;

          if (!playerToken) {
            throw new Error("Missing seated player token for authorized move execution");
          }

          const { data: rpcResult, error: rpcError } = await supabase.rpc("submit_turn_move", {
            p_room_id: session.id,
            p_player_token: playerToken,
            p_expected_version: session.version,
            p_move_id: moveData.id,
            p_ply: moveData.ply,
            p_player: moveData.player,
            p_from_coord: moveData.from ?? null,
            p_to_coord: moveData.to,
            p_payload: moveData.payload ?? null,
            p_board_snapshot: session.boardSnapshot,
            p_winner: session.winner,
            p_status: session.status,
          });

          if (rpcError) throw rpcError;

          if (rpcResult !== "success") {
            await localDb.games.update(item.gameId, { syncState: "conflict" });

            const isTransientConflict = rpcResult === "version_conflict";
            if (isTransientConflict && item.retryCount < 3) {
              await localDb.syncQueue.update(item.id, { retryCount: item.retryCount + 1 });
            } else {
              await localDb.syncQueue.delete(item.id);
            }
            continue;
          }

          await localDb.games.update(item.gameId, {
            syncState: "synced",
            version: session.version + 1,
          });
          break;
        }

        case "RESIGN":
        case "RESET": {
          const { data: updatedRoom, error: updateError } = await supabase
            .from("game_rooms")
            .update({
              board_snapshot: session.boardSnapshot,
              status: session.status,
              winner: session.winner,
              current_turn: session.currentTurn,
              version: session.version + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.gameId)
            .eq("version", session.version)
            .select("version");

          if (updateError) throw updateError;

          if (!updatedRoom || updatedRoom.length === 0) {
            await localDb.games.update(item.gameId, { syncState: "conflict" });
            await localDb.syncQueue.update(item.id, { retryCount: item.retryCount + 1 });
            continue;
          }

          await localDb.games.update(item.gameId, {
            syncState: "synced",
            version: session.version + 1,
          });
          break;
        }
      }

      await localDb.syncQueue.delete(item.id);
    } catch (error: unknown) {
      if (isNetworkError(error)) {
        break;
      }

      const nextRetryCount = item.retryCount + 1;
      if (nextRetryCount >= 3) {
        await localDb.syncQueue.delete(item.id);
        await localDb.games.update(item.gameId, { syncState: "conflict" });
      } else {
        await localDb.syncQueue.update(item.id, { retryCount: nextRetryCount });
      }

      continue;
    }
  }
}
