"use client";

/**
 * Client half of the local route: resolve-or-create, then render.
 *
 * A local match is resumed when one exists and created when none does, so the
 * browser can close and reopen `/<gameKind>` — `/checkers`, `/hex` — without
 * losing the board. The lookup runs against IndexedDB only, which is what
 * makes a local match local.
 *
 * Three states are real and each is rendered rather than hidden behind a
 * spinner: resolving, ready, and unresolvable. A `?session=` id that matches
 * nothing falls back to a fresh match, because a dead link should still play.
 */

import { useEffect, useState } from "react";

import { createGameSession } from "@/hooks/useGameSession";
import { getSessionById, isLocalDbAvailable, listSessionsByKind, putSession } from "@/lib/db";
import { createId, createSeatToken } from "@/lib/utils";
import type { GameKind, GameSession } from "@/engine/types";
import { GameScreen } from "@/components/game/GameScreen";

export interface LocalGameRouteProps {
  readonly gameKind: GameKind;
  /** `?session=` — the id of a specific match to resume. */
  readonly resumeSessionId: string | null;
}

type Resolution =
  | { readonly state: "resolving" }
  | { readonly state: "ready"; readonly session: GameSession }
  | { readonly state: "failed"; readonly message: string };

export function LocalGameRoute({
  gameKind,
  resumeSessionId,
}: LocalGameRouteProps): React.ReactElement {
  const [resolution, setResolution] = useState<Resolution>({ state: "resolving" });

  useEffect(() => {
    let cancelled = false;

    const resolve = async (): Promise<void> => {
      if (!isLocalDbAvailable()) {
        // Without IndexedDB the match still plays — it just cannot be reopened
        // after a refresh, and the screen says so in its status line.
        setResolution({
          state: "ready",
          session: createGameSession({
            gameKind,
            mode: "offline_local",
            playerBlackToken: createSeatToken(),
            localSeat: "black",
          }),
        });
        return;
      }

      try {
        if (resumeSessionId) {
          const existing = await getSessionById(resumeSessionId);
          if (existing && existing.gameKind === gameKind && existing.mode === "offline_local") {
            if (!cancelled) setResolution({ state: "ready", session: existing });
            return;
          }
        }

        // No explicit id: resume the most recent match of this kind that is
        // still in play. A finished one is not resumed — the player asked for
        // a game, and the finished board is one click away from the lobby.
        const recent = await listSessionsByKind(gameKind);
        const resumable = recent.find(
          (candidate) => candidate.mode === "offline_local" && candidate.status === "active"
        );
        if (resumable && !cancelled) {
          setResolution({ state: "ready", session: resumable });
          return;
        }

        const created = createGameSession({
          id: createId(),
          gameKind,
          mode: "offline_local",
          playerBlackToken: createSeatToken(),
          localSeat: "black",
        });
        await putSession(created);
        if (!cancelled) setResolution({ state: "ready", session: created });
      } catch (error: unknown) {
        if (cancelled) return;
        setResolution({
          state: "failed",
          message:
            error instanceof Error
              ? `Local storage rejected this match: ${error.message}`
              : "Local storage rejected this match.",
        });
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [gameKind, resumeSessionId]);

  if (resolution.state === "resolving") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh items-center justify-center bg-board-light text-sm text-board-muted"
      >
        Loading your match…
      </div>
    );
  }

  if (resolution.state === "failed") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-board-light p-6 text-center text-board-dark">
        <h1 className="text-lg font-semibold">This match could not be opened</h1>
        <p className="max-w-sm text-sm text-board-muted">{resolution.message}</p>
      </div>
    );
  }

  return <GameScreen gameKind={gameKind} roomId={null} seat="black" initialSession={resolution.session} />;
}
