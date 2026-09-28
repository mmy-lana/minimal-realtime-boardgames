"use client";

/**
 * Section 4.4 — realtime fan-in and the integrity gate.
 *
 * Two things arrive over a Supabase Realtime subscription: new rows in
 * `game_moves`, and changes to the `game_rooms` row itself. Neither is trusted
 * as board state. Every incoming move is replayed through the rule engine
 * against the last board this client verified, and the result is compared
 * against the snapshot the server broadcast. Agreement means the two copies
 * stayed in step; disagreement sets `syncState: "conflict"`, which makes
 * `useGameSession` refuse every further move and makes `GameOverDialog` raise
 * the invalid-state modal.
 *
 * On mount and on every reconnect the whole history is replayed in memory
 * from the initial board, which is the only way to be sure a fresh client
 * showing a loaded room is looking at a legal game.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  assertBoardSnapshot,
  boardStatesEqual,
  Coordinates,
  GameSession,
  PlayerColor,
  UniversalBoard,
} from "@/engine/types";
import { getSessionEngine, replayMoves } from "@/engine/factory";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import {
  deriveNetworkPresentation,
  type NetworkPresentation,
  type RealtimeConnectionState,
} from "@/lib/realtime";
import { describeError } from "@/lib/utils";

/** One row of `game_moves`, narrowed to the columns this module needs. */
export interface RemoteMove {
  readonly id: string;
  readonly room_id: string;
  /** The room reset_epoch in force when this move was played. */
  readonly epoch: number;
  readonly ply: number;
  readonly player: "black" | "white";
  readonly from_coord: { x: number; y: number } | null;
  readonly to_coord: { x: number; y: number };
  readonly payload: string | null;
}

/** The subset of `game_rooms` this module reads. */
export interface RemoteRoom {
  readonly id: string;
  readonly status: string;
  readonly current_turn: "black" | "white";
  readonly turn_number: number;
  readonly board_snapshot: unknown;
  readonly winner: "black" | "white" | null;
  readonly version: number;
  readonly reset_epoch: number;
  readonly player_white_token: string | null;
}

export type RealtimeStatus =
  | "idle"
  | "loading"
  | "verifying"
  | "live"
  | "conflict"
  | "unsupported"
  | "error";

export interface UseSupabaseRealtimeOptions {
  /** Room to subscribe to. Passing null tears the subscription down. */
  readonly roomId: string | null;
  /** The locally held session, used as the replay baseline. */
  readonly localSession: GameSession | null;
  /**
   * Receives a session that has been rebuilt and verified from the server's
   * move log. Returning without calling this leaves the caller's own state
   * alone, which is what a conflicting replay should do.
   */
  readonly onVerifiedSession: (session: GameSession) => void;
  /** Called when this client observes a genuine divergence. */
  readonly onConflict: (reason: string) => void;
  /** Receives every accepted remote move, for the timeline and sound cues. */
  readonly onRemoteMove?: (move: RemoteMove) => void;
  /** Stops this client from writing the board, e.g. while spectating. */
  readonly readOnly?: boolean;
}

export interface UseSupabaseRealtimeResult {
  readonly status: RealtimeStatus;
  readonly connection: RealtimeConnectionState;
  /** True once the move log has been replayed and agreed with the snapshot. */
  readonly isVerified: boolean;
  /** Populated only when `status === "conflict"`. */
  readonly conflictReason: string | null;
  readonly lastMoveAt: number | null;
  readonly presentation: NetworkPresentation;
  /** Re-fetches and re-verifies on demand, e.g. from a "retry" button. */
  readonly revalidate: () => Promise<void>;
  /** Leaves the channel and clears local realtime state. */
  readonly disconnect: () => void;
}

function isCoord(value: unknown): value is Coordinates {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return Number.isInteger(candidate.x) && Number.isInteger(candidate.y);
}

function toCoord(value: unknown): Coordinates | null {
  if (!isCoord(value)) return null;
  return { x: value.x as number, y: value.y as number };
}

/** A remote `from_coord` is absent for the games that use a single square. */
function readMove(row: Record<string, unknown>): RemoteMove | null {
  const to = toCoord(row.to_coord);
  if (!to) return null;
  const player = row.player;
  if (player !== "black" && player !== "white") return null;
  const ply = row.ply;
  if (typeof ply !== "number") return null;
  return {
    id: typeof row.id === "string" ? row.id : `${String(row.id)}`,
    room_id: typeof row.room_id === "string" ? row.room_id : "",
    epoch: readEpoch(row.epoch),
    ply,
    player,
    from_coord: toCoord(row.from_coord),
    to_coord: to,
    payload: typeof row.payload === "string" ? row.payload : null,
  };
}

/**
 * Reads a `reset_epoch`. The column is `not null` with a default, so a well-formed
 * deployment always supplies it; a room written before the column existed reads
 * as epoch 0, which is exactly the epoch its moves were stamped with.
 */
function readEpoch(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function useSupabaseRealtime(
  options: UseSupabaseRealtimeOptions
): UseSupabaseRealtimeResult {
  const { roomId, localSession, onVerifiedSession, onConflict, onRemoteMove, readOnly = false } = options;

  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [connection, setConnection] = useState<RealtimeConnectionState>("idle");
  const [isVerified, setIsVerified] = useState(false);
  const [conflictReason, setConflictReason] = useState<string | null>(null);
  const [lastMoveAt, setLastMoveAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  /** The last board this client proved correct, and the ply it proves to. */
  // `moves` is part of the baseline, not a convenience. A rule that reads the
  // move log — Tic-Tac-Toe lifting the oldest of a player's marks — can only be
  // applied to the next move if the plies behind the baseline are still in
  // hand, and a baseline that kept only the board would have to guess them.
  const verifiedRef = useRef<{
    sessionId: string;
    ply: number;
    board: UniversalBoard;
    moves: { player: PlayerColor; to: Coordinates }[];
  } | null>(null);
  /**
   * The room's `reset_epoch` as this client last saw it. Moves carry the epoch
   * they were played in, and a reset starts a new log on the same room, so this
   * is what decides which moves belong to the game currently being played.
   */
  const epochRef = useRef(0);
  const conflictRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const raiseConflict = useCallback((reason: string) => {
    if (conflictRef.current !== null) return;
    conflictRef.current = reason;
    setStatus("conflict");
    setConflictReason(reason);
    setIsVerified(false);
    optionsRef.current.onConflict(reason);
  }, []);

  /**
   * Rebuilds the board from the initial position through every recorded move
   * and checks the result against the server's snapshot. This is the plan's
   * integrity gate: a client that cannot reproduce the room's board must not be
   * allowed to move on it.
   */
  const verifyAgainstHistory = useCallback(
    async (reason: "initial" | "reconnect" | "manual"): Promise<boolean> => {
      const session = optionsRef.current.localSession;
      if (!session || !optionsRef.current.roomId) return false;

      if (reason !== "initial") setStatus("verifying");
      const supabase = getSupabaseClient();
      const engine = getSessionEngine(session.gameKind);
      const roomId = optionsRef.current.roomId;

      // The epoch has to be read before the moves can be filtered, because it
      // decides which moves belong to the game in progress. Moves from earlier
      // epochs stay in the table forever — a reset preserves the game that came
      // before it — so filtering by room alone would replay the abandoned game
      // on top of the new one and produce a board that matches nothing.
      const roomResult = await supabase
        .from("game_rooms")
        .select("reset_epoch")
        .eq("id", roomId)
        .single();

      if (roomResult.error) {
        setConnection("error");
        setStatus("error");
        return false;
      }

      const epoch = readEpoch((roomResult.data as { reset_epoch?: unknown } | null)?.reset_epoch);
      epochRef.current = epoch;

      const { data, error } = await supabase
        .from("game_moves")
        .select("id, room_id, epoch, ply, player, from_coord, to_coord, payload")
        .eq("room_id", roomId)
        .eq("epoch", epoch)
        .order("ply", { ascending: true });

      if (error) {
        setConnection("error");
        setStatus("error");
        return false;
      }

      const rows = (data ?? []).map((row) => readMove(row as Record<string, unknown>));
      const moves = rows.filter((row): row is RemoteMove => row !== null);

      // A ply gap means the move log itself is incomplete; replaying what is
      // there would produce a board that looks valid and is not. The gap check
      // is per-epoch, which is why the query above is scoped to one: ply
      // numbering restarts at 1 after a reset, and the previous game's plies
      // are not a gap in this one.
      for (let index = 0; index < moves.length; index += 1) {
        if (moves[index]?.ply !== index + 1) {
          raiseConflict("The move history has a gap, so the board cannot be verified.");
          return false;
        }
      }

      let board = engine.createInitialBoard();
      let winner: "black" | "white" | null = null;
      let isDraw = false;
      try {
        // `replayMoves` takes the engine's own move shape, so the row shape is
        // projected rather than widened. A Reversi pass is re-derived from the
        // board, so the `payload` column is not consulted for correctness.
        const replayed = replayMoves(
          board,
          moves.map((move) => ({
            player: move.player,
            to: move.to_coord,
            ...(move.from_coord ? { from: move.from_coord } : {}),
          }))
        );
        board = replayed.board;
        winner = replayed.winner;
        isDraw = replayed.isDraw;
      } catch (error) {
        raiseConflict(
          describeError(error, "The recorded moves could not be replayed from the opening position.")
        );
        return false;
      }

      assertBoardSnapshot(board, session.gameKind);

      if (!boardStatesEqual(board, session.boardSnapshot)) {
        raiseConflict("The board on the server does not match its own move history.");
        return false;
      }

      verifiedRef.current = {
        sessionId: session.id,
        ply: moves.length,
        board,
        // The same projection `replayMoves` was just given, so the incremental
        // fold below continues from exactly the log the replay used.
        moves: moves.map((move) => ({ player: move.player, to: move.to_coord })),
      };

      const next: GameSession = {
        ...session,
        boardSnapshot: board,
        history: moves.map((move) => ({
          id: move.id,
          gameId: move.room_id || session.id,
          ply: move.ply,
          player: move.player,
          to: move.to_coord,
          ...(move.from_coord ? { from: move.from_coord } : {}),
          ...(move.payload !== null ? { payload: move.payload } : {}),
          timestamp: 0,
        })),
        turnNumber: moves.length,
        winner: winner ?? session.winner,
        ...(isDraw ? { status: "draw" as const } : {}),
        updatedAt: Date.now(),
        syncState: "synced",
      };

      conflictRef.current = null;
      setConflictReason(null);
      setIsVerified(true);
      setStatus("live");
      setLastMoveAt(Date.now());
      optionsRef.current.onVerifiedSession(next);
      return true;
    },
    [raiseConflict]
  );

  const revalidate = useCallback(async () => {
    await verifyAgainstHistory("manual");
  }, [verifyAgainstHistory]);

  const disconnect = useCallback(() => {
    const channel = channelRef.current;
    channelRef.current = null;
    if (channel) {
      const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
      // Leaving is best-effort: the channel is discarded either way, and an
      // unsubscribe failure must not surface as an application error.
      void supabase?.removeChannel(channel).catch(() => undefined);
    }
    setConnection("idle");
    setStatus("idle");
    setIsVerified(false);
  }, []);

  // Subscribe, verify, and tear down whenever the room identity changes.
  useEffect(() => {
    if (!roomId) {
      disconnect();
      return;
    }
    if (!isSupabaseConfigured()) {
      setConnection("unsupported");
      setStatus("unsupported");
      return;
    }

    const supabase = getSupabaseClient();
    let cancelled = false;

    setStatus("loading");
    setConnection("connecting");
    verifiedRef.current = null;
    conflictRef.current = null;
    // A different room is at a different epoch. Leaving the old room's value in
    // place would make every insert from the new room look like it belonged to
    // a superseded game and be dropped until the first verification lands.
    epochRef.current = 0;

    const channel = supabase.channel(`room:${roomId}`, {
      config: { broadcast: { self: false }, presence: { key: roomId } },
    });
    channelRef.current = channel;

    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "game_moves", filter: `room_id=eq.${roomId}` }, (payload) => {
      if (cancelled) return;
      const move = readMove(payload.new as Record<string, unknown>);
      if (!move) return;

      // The subscription is scoped to the room, not to one epoch, so it carries
      // every move ever played here. A move from an earlier epoch belongs to a
      // game that has already been reset away; applying it to the current board
      // would corrupt the very baseline the client just proved correct.
      if (move.epoch !== epochRef.current) return;

      const verified = verifiedRef.current;
      const session = optionsRef.current.localSession;
      if (!verified || !session || verified.sessionId !== session.id) {
        // The baseline is gone, so a single row cannot be checked in isolation.
        void verifyAgainstHistory("reconnect");
        return;
      }
      if (move.ply <= verified.ply) return; // already folded into the baseline

      const engine = getSessionEngine(session.gameKind);
      let nextBoard: UniversalBoard;
      try {
        // The plies already folded in travel with the move. Without them a rule
        // that needs the log cannot see it, and the board this client holds
        // stops matching the board every other client and the server hold — at
        // which point the next legal move looks illegal and the match pauses
        // itself for no visible reason.
        const applied = engine.applyMove(
          verified.board,
          { to: move.to_coord, ...(move.from_coord ? { from: move.from_coord } : {}) },
          move.player,
          { history: verified.moves }
        );
        nextBoard = applied.board;
        verifiedRef.current = {
          sessionId: verified.sessionId,
          ply: move.ply,
          board: nextBoard,
          moves: [...verified.moves, { player: move.player, to: move.to_coord }],
        };
      } catch (error) {
        raiseConflict(
          describeError(error, "An incoming move is not legal for this board, so play is paused.")
        );
        return;
      }

      setLastMoveAt(Date.now());
      setStatus((current) => (current === "conflict" ? current : "live"));
      optionsRef.current.onRemoteMove?.(move);
    });

    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` }, (payload) => {
      if (cancelled) return;
      const next = payload.new as unknown as RemoteRoom;
      const session = optionsRef.current.localSession;
      if (!session || next.id !== session.id) return;

      // The room row is authoritative for *who* moves next and whether the
      // match is finished, but the board is only adopted after a replay has
      // proved it, so a corrupted snapshot can never be rendered as truth.
      if (next.version < session.version) return;

      // A reset advanced the epoch, so the baseline describes a game that is
      // over. It is dropped here rather than left to the re-verification below,
      // because ply numbering restarts at 1 in the new epoch: until the
      // baseline is gone, the first move of the new game compares as
      // `ply <= verified.ply` and is discarded as though already replayed.
      if (readEpoch(next.reset_epoch) !== epochRef.current) {
        epochRef.current = readEpoch(next.reset_epoch);
        verifiedRef.current = null;
        setIsVerified(false);
      }

      void verifyAgainstHistory("reconnect");
    });

    channel.subscribe((state) => {
      if (cancelled) return;
      switch (state) {
        case "SUBSCRIBED":
          setConnection("connected");
          void verifyAgainstHistory("initial");
          break;
        case "CHANNEL_ERROR":
        case "TIMED_OUT":
          setConnection("error");
          setStatus("error");
          break;
        case "CLOSED":
          setConnection("idle");
          setStatus("idle");
          break;
        default:
          setConnection("reconnecting");
          break;
      }
    });

    return () => {
      cancelled = true;
      channelRef.current = null;
      void supabase.removeChannel(channel).catch(() => undefined);
    };
  }, [roomId, disconnect, raiseConflict, verifyAgainstHistory]);

  // Keep the queue depth in the indicator; it is the only visible difference
  // between "connected" and "connected but with unsent work".
  useEffect(() => {
    if (readOnly || !localSession || localSession.mode !== "online_realtime") return;
    let cancelled = false;
    void (async () => {
      const { countPendingSyncItems } = await import("@/lib/db");
      const count = await countPendingSyncItems();
      if (!cancelled) setPendingCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [localSession, readOnly]);

  const presentation = useMemo(
    () =>
      deriveNetworkPresentation({
        connection,
        isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
        pendingCount,
        syncState: conflictRef.current !== null ? "conflict" : localSession?.syncState ?? "synced",
      }),
    [connection, pendingCount, localSession?.syncState]
  );

  return {
    status,
    connection,
    isVerified,
    conflictReason,
    lastMoveAt,
    presentation,
    revalidate,
    disconnect,
  };
}
