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
import {
  readSessionValue,
  seatColorKey,
  seatTokenKey,
  writeSessionValue,
} from "@/lib/seatStorage";
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

      // The key is built by `seatStorage`, not by a literal here: the lobby
      // wrote this entry, so the two have to agree on one string. A key with
      // no application prefix is a key anything else on the origin can also
      // write, and a room id is not a secret.
      const seatKey = seatTokenKey(roomId);
      const colorKey = seatColorKey(roomId);
      let token = readSessionValue(seatKey);
      const savedColor = readSessionValue(colorKey);
      // The seat this browser believes it holds, pending the server's answer.
      // `joinRoom` is authoritative and the assignment below overwrites this.
      let seat: PlayerColor = savedColor === "white" ? "white" : "black";
      // A host is the one browser that minted the room: it already holds a
      // token *and* the black colour key, both written by the lobby. Only that
      // browser may create the row — a guest arriving at a room that does not
      // exist yet has no business conjuring it into existence.
      const isHost = savedColor === "black" && token !== null;

      if (token === null) {
        token = createSeatToken();
      }

      try {
        let code = await joinRoom(roomId, token);

        // If the room does not exist yet on Supabase and this client is the
        // designated host, create it. The lobby mints a room id and a token
        // before the row exists, so the host's very first navigation can land
        // before the insert has happened; without this the host is told "This
        // room does not exist" about a room they just made.
        if (code === "room_not_found" && isHost) {
          const { getSupabaseClient } = await import("@/lib/supabase");
          const { getSessionEngine } = await import("@/engine/factory");
          const supabase = getSupabaseClient();
          const engine = getSessionEngine(gameKind);
          const initialBoard = engine.createInitialBoard();
          const nowIso = new Date().toISOString();

          await supabase.from("game_rooms").upsert(
            {
              id: roomId,
              game_kind: gameKind,
              status: "waiting",
              player_black_token: token,
              player_white_token: null,
              current_turn: "black",
              turn_number: 1,
              board_snapshot: initialBoard,
              winner: null,
              version: 1,
              created_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: "id", ignoreDuplicates: true }
          );

          code = await joinRoom(roomId, token);
        }

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

        // The seat comes from the RPC's own assignment rather than from the
        // colour key this browser happened to have cached. The key is a
        // *guess* made before the join; the server is what actually decided,
        // and every downstream credential is built from that decision.
        const assignedSeat: PlayerColor = code === "seated_white" ? "white" : "black";

        // Written only after the join succeeded: a token for a seat this browser
        // does not hold is worse than no token, because the next load would skip
        // the claim entirely and present a board it is not seated to play.
        writeSessionValue(seatKey, token as string);
        writeSessionValue(colorKey, assignedSeat);

        seat = assignedSeat;
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

  // `navigator.clipboard` is undefined outside a secure context and blocked in
  // some in-app webviews, and `?.` alone turns that into a silent no-op: the
  // player taps "Copy link" and nothing happens and nothing is said. The
  // fallback uses the legacy selection trick, which works wherever a document
  // exists.
  const fallbackCopy = (text: string) => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } catch {
      // Best effort: a browser that refuses both paths has no copy affordance
      // left, and the URL is visible in the address bar regardless.
    }
  };

  const copyLink = useCallback(() => {
    const url = window.location.href;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard.writeText(url).catch(() => {
        fallbackCopy(url);
      });
    } else {
      fallbackCopy(url);
    }
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
