"use client";

/**
 * Client half of the realtime route.
 *
 * The order of operations here is the trust model made visible:
 *
 *  1. Claim a seat through the `join_room` RPC. A seat token already in this
 *     browser's session storage means the player is returning to a room they
 *     created or joined, so it is reused and no second seat is claimed.
 *  2. Load the room, then let `useSupabaseRealtime` replay the entire server
 *     move log through the rule engine and compare the result to the room's
 *     `board_snapshot`.
 *  3. Only after that comparison agrees does the board become playable. Until
 *     then the shell renders with every input locked, because a board that has
 *     not been verified has no business accepting a move.
 *
 * A mismatch is not an error screen and not a loss: `useSupabaseRealtime`
 * reports it, the session is marked `syncState: "conflict"`, `canLocalPlayerAct`
 * returns false, and the board locks itself behind the conflict dialog. That is
 * the plan's integrity gate, and it is the reason a client-authoritative engine
 * can be trusted in a two-player room at all.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useSupabaseRealtime } from "@/hooks/useSupabaseRealtime";
import { createGameSession } from "@/hooks/useGameSession";
import { getSessionById, isLocalDbAvailable, putSession } from "@/lib/db";
import { isJoinSuccess, joinRoom } from "@/lib/sync";
import { getSupabaseConfigError } from "@/lib/supabase";
import { createSeatToken } from "@/lib/utils";
import type { GameKind, GameSession, PlayerColor } from "@/engine/types";
import { GameScreen } from "@/components/game/GameScreen";

export interface RealtimeGameRouteProps {
  readonly gameKind: GameKind;
  readonly roomId: string;
}

type Entry =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly session: GameSession; readonly seat: PlayerColor }
  | { readonly state: "blocked"; readonly message: string };

const SEAT_KEY = "seat";
const SEAT_COLOR_KEY = "seat-color";

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(key);
}

export function RealtimeGameRoute({
  gameKind,
  roomId,
}: RealtimeGameRouteProps): React.ReactElement {
  const [entry, setEntry] = useState<Entry>({ state: "loading" });
  const [conflictReason, setConflictReason] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  /**
   * The realtime hook needs a session before it can verify anything, and
   * `GameScreen` needs the adopt function before the hook can hand back a
   * verified one. The two are wired together through this ref, which holds the
   * adopt callback as soon as the screen mounts.
   */
  const adoptRef = useRef<((session: GameSession) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const enter = async (): Promise<void> => {
      const configError = getSupabaseConfigError();
      if (configError !== null) {
        setEntry({
          state: "blocked",
          message: `${configError} A local match of this game still works from the lobby.`,
        });
        return;
      }

      const seatKey = `room:${roomId}:${SEAT_KEY}`;
      const seatColorKey = `room:${roomId}:${SEAT_COLOR_KEY}`;
      let token = readStored(seatKey);
      let seat: PlayerColor = readStored(seatColorKey) === "white" ? "white" : "black";

      if (token === null) {
        token = createSeatToken();
      }

      try {
        const code = await joinRoom(roomId, token);
        if (cancelled) return;
        if (!isJoinSuccess(code)) {
          setEntry({
            state: "blocked",
            message:
              code === "room_full"
                ? "This room already has two players. Ask the host for a new link."
                : code === "room_not_found"
                  ? "This room does not exist. The link may be incomplete or the room may have been removed."
                  : code === "room_closed"
                  ? "This room has been closed by its host. Ask them for a new link."
                  : "This room could not be joined. Try again in a moment.",
          });
          return;
        }
      } catch (error: unknown) {
        if (cancelled) return;
        setEntry({
          state: "blocked",
          message:
            error instanceof Error
              ? `The room could not be reached: ${error.message}`
              : "The room could not be reached.",
        });
        return;
      }

      if (typeof window !== "undefined") {
        sessionStorage.setItem(seatKey, token as string);
        sessionStorage.setItem(seatColorKey, seat);
      }

      // A locally cached copy of this room is the verification baseline. If
      // there is none — a second player arriving for the first time — an empty
      // session is created, which the replay will then populate.
      let session: GameSession | null = null;
      if (isLocalDbAvailable()) {
        try {
          session = (await getSessionById(roomId)) ?? null;
        } catch {
          session = null;
        }
      }
      if (cancelled) return;

      if (!session || session.gameKind !== gameKind) {
        session = createGameSession({
          id: roomId,
          gameKind,
          mode: "online_realtime",
          playerBlackToken: seat === "black" ? (token as string) : createSeatToken(),
          playerWhiteToken: seat === "white" ? (token as string) : null,
          localSeat: seat,
        });
        if (isLocalDbAvailable()) {
          try {
            await putSession(session);
          } catch {
            // A failed baseline write is not fatal: the replay still verifies
            // against the server, which is the authority.
          }
        }
      }

      if (cancelled) return;
      setEntry({ state: "ready", session, seat });
    };

    void enter();
    return () => {
      cancelled = true;
    };
  }, [gameKind, roomId]);

  const onVerifiedSession = useCallback((next: GameSession) => {
    adoptRef.current?.(next);
    setConflictReason(null);
  }, []);

  const onConflict = useCallback((reason: string) => {
    setConflictReason(reason);
  }, []);

  const onRemoteMove = useCallback(() => {
    // The move itself arrives through the verified session, so nothing is
    // applied here. The hook exists to make the notification point explicit.
  }, []);

  const realtime = useSupabaseRealtime({
    roomId: entry.state === "ready" ? roomId : null,
    localSession: entry.state === "ready" ? entry.session : null,
    onVerifiedSession,
    onConflict,
    onRemoteMove,
  });

  const adopt = useCallback((adopter: (session: GameSession) => void) => {
    adoptRef.current = adopter;
  }, []);

  const revalidate = useCallback(() => {
    setIsVerifying(true);
    void realtime
      .revalidate()
      .catch((error: unknown) => {
        setConflictReason(
          error instanceof Error
            ? `The re-check failed: ${error.message}`
            : "The re-check failed."
        );
      })
      .finally(() => setIsVerifying(false));
  }, [realtime]);

  const copyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href);
  }, []);

  // Verification gates the board. Until the replay has agreed with the
  // server's snapshot, every input stays locked. The gate is passed explicitly
  // rather than being faked by rewriting `syncState`: "not verified yet" and
  // "verified and found wrong" are different facts and the UI must not
  // conflate them.
  const isVerified = realtime.isVerified;
  const session = entry.state === "ready" ? entry.session : null;

  if (entry.state === "blocked") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-board-light p-6 text-center text-board-dark">
        <h1 className="text-lg font-semibold">This room is not available</h1>
        <p className="max-w-sm text-sm text-board-muted">{entry.message}</p>
        <p className="max-w-sm text-xs text-board-muted">
          Rooms need a running Supabase instance and a matching `.env.local`. Check the server
          before opening an invite link.
        </p>
      </div>
    );
  }

  if (entry.state === "loading" || !session) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-board-light text-board-dark"
      >
        <p className="text-sm text-board-muted">Joining the room…</p>
        <p className="text-xs text-board-muted">
          The move log is replayed before the board unlocks.
        </p>
      </div>
    );
  }

  return (
    <GameScreen
      gameKind={gameKind}
      roomId={roomId}
      seat={entry.seat}
      initialSession={session}
      locked={!isVerified}
      isSharedLink
      onCopyLink={copyLink}
      onAdoptRemoteSession={adopt}
      conflict={{
        reason: conflictReason ?? realtime.conflictReason,
        isVerifying: isVerifying,
        onRevalidate: revalidate,
      }}
    />
  );
}
